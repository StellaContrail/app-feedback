import { Hono, type Context, type Next } from "hono";
import {
  feedbackSchema,
  normalizePath,
  pageIdentity,
  withinBase,
} from "@app-feedback/shared";

import { hash, secret } from "./crypto";
import {
  googleConfig,
  fixedDestination,
  GoogleAuthError,
  startGoogleLogin,
  completeGoogleLogin,
  type GoogleBindings,
} from "./google-auth";
export { hash } from "./crypto";
type Bindings = { DB: D1Database } & GoogleBindings;
type Participant = { id: string; session_id: string };
const app = new Hono<{
  Bindings: Bindings;
  Variables: { participant: Participant; body: unknown };
}>();
const error = (code: string, message: string) => ({ error: { code, message } });
app.onError((err, c) =>
  err instanceof GoogleAuthError
    ? c.json(error(err.code, err.message), err.status)
    : c.json(error("INTERNAL_ERROR", "Request failed"), 500),
);
app.notFound((c) => c.json(error("NOT_FOUND", "Not found"), 404));
app.use("*", async (c, next) => {
  if (c.req.url.length > 8192)
    return c.json(error("VALIDATION_ERROR", "URL too long"), 400);
  const origin = c.req.header("Origin");
  const allowed = c.env.EXTENSION_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => /^chrome-extension:\/\/[a-p]{32}$/.test(s));
  c.header("Vary", "Origin");
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  if (origin && !allowed.includes(origin))
    return c.json(error("FORBIDDEN", "Origin denied"), 403);
  if (origin) c.header("Access-Control-Allow-Origin", origin);
  if (c.req.method === "OPTIONS") {
    if (
      !origin ||
      !["GET", "POST"].includes(
        c.req.header("Access-Control-Request-Method") ?? "",
      ) ||
      (c.req.header("Access-Control-Request-Headers") ?? "")
        .split(",")
        .some(
          (h) =>
            h.trim() &&
            !["authorization", "content-type"].includes(h.trim().toLowerCase()),
        )
    )
      return c.json(error("FORBIDDEN", "Preflight denied"), 403);
    c.header("Access-Control-Allow-Methods", "GET, POST");
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    return c.body(null, 204);
  }
  await next();
});
app.get("/health", (c) => c.json({ status: "ok" }));
// Stream the body with a hard byte limit; Content-Length alone is untrusted.
app.use("/v1/*", async (c, next) => {
  if (c.req.method === "POST") {
    if (
      c.req.header("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json"
    )
      return c.json(error("VALIDATION_ERROR", "JSON required"), 400);
    const reader = c.req.raw.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          return c.json(error("PAYLOAD_TOO_LARGE", "Body too large"), 413);
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      c.set(
        "body",
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ) as unknown,
      );
    } catch {
      return c.json(error("VALIDATION_ERROR", "Invalid body"), 400);
    }
  }
  await next();
});
async function budget(
  db: D1Database,
  identity: string,
  maximum: number,
): Promise<boolean> {
  const now = Date.now(),
    window = Math.floor(now / 60000);
  const bucket = await hash(`${identity}:${window}`);
  await db
    .prepare("DELETE FROM request_limits WHERE expires_at < ?")
    .bind(now)
    .run();
  const row = await db
    .prepare(
      "INSERT INTO request_limits(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
    )
    .bind(bucket, (window + 2) * 60000)
    .first<{ attempts: number }>();
  return !!row && row.attempts <= maximum;
}
// Operators select the destination; Google authentication is always required.
for (const phase of ["start", "join"] as const) {
  app.post(`/v1/auth/google/${phase}`, async (c) => {
    googleConfig(c.env);
    const destination = await fixedDestination(c.env.DB, c.env);
    if (
      !(await budget(
        c.env.DB,
        `fixed-google:${phase}:ip:${c.req.header("CF-Connecting-IP") ?? "local"}`,
        10,
      )) ||
      !(await budget(
        c.env.DB,
        `fixed-google:${phase}:session:${destination.sessionId}`,
        60,
      ))
    ) {
      c.header("Retry-After", "60");
      return c.json(error("RATE_LIMITED", "Try again later"), 429);
    }
    if (phase === "start")
      return c.json(
        await startGoogleLogin(
          c.env.DB,
          c.env,
          destination.sessionId,
          c.get("body"),
          c.req.header("Origin"),
          true,
        ),
        201,
      );
    const result = await completeGoogleLogin(
      c.env.DB,
      c.env,
      destination.sessionId,
      c.get("body"),
    );
    return c.json({ ...result, ...destination }, 201);
  });
}
app.post("/v1/sessions/:sessionId/google/start", async (c) => {
  googleConfig(c.env);
  if (
    !(await budget(
      c.env.DB,
      `google-start:ip:${c.req.header("CF-Connecting-IP") ?? "local"}`,
      10,
    )) ||
    !(await budget(
      c.env.DB,
      `google-start:session:${c.req.param("sessionId")}`,
      60,
    ))
  ) {
    c.header("Retry-After", "60");
    return c.json(error("RATE_LIMITED", "Try again later"), 429);
  }
  return c.json(
    await startGoogleLogin(
      c.env.DB,
      c.env,
      c.req.param("sessionId"),
      c.get("body"),
      c.req.header("Origin"),
    ),
    201,
  );
});
app.post("/v1/sessions/:sessionId/join", async (c) => {
  googleConfig(c.env);
  if (
    !(await budget(
      c.env.DB,
      `join:ip:${c.req.header("CF-Connecting-IP") ?? "local"}`,
      10,
    )) ||
    !(await budget(c.env.DB, `join:session:${c.req.param("sessionId")}`, 60))
  ) {
    c.header("Retry-After", "60");
    return c.json(error("RATE_LIMITED", "Try again later"), 429);
  }
  return c.json(
    await completeGoogleLogin(
      c.env.DB,
      c.env,
      c.req.param("sessionId"),
      c.get("body"),
    ),
    201,
  );
});
const participantAuth = async (
  c: Context<{
    Bindings: Bindings;
    Variables: { participant: Participant; body: unknown };
  }>,
  next: Next,
) => {
  googleConfig(c.env);
  const match = /^Bearer ([a-f0-9]{64})$/.exec(
    c.req.header("Authorization") ?? "",
  );
  if (!match) return c.json(error("UNAUTHORIZED", "Invalid credentials"), 401);
  const now = new Date().toISOString();
  const participant = await c.env.DB.prepare(
    "SELECT p.id,p.session_id FROM participants p JOIN sessions s ON s.id=p.session_id WHERE p.token_hash=? AND p.expires_at>? AND s.expires_at>? AND p.google_subject_hash IS NOT NULL",
  )
    .bind(await hash(match[1]), now, now)
    .first<Participant>();
  if (!participant)
    return c.json(error("UNAUTHORIZED", "Invalid credentials"), 401);
  if (!(await budget(c.env.DB, `participant:${participant.id}`, 120))) {
    c.header("Retry-After", "60");
    return c.json(error("RATE_LIMITED", "Try again later"), 429);
  }
  c.set("participant", participant);
  await next();
};
app.use("/v1/apps/*", participantAuth);
app.use("/v1/participants/logout", participantAuth);
app.post("/v1/participants/logout", async (c) => {
  await c.env.DB.prepare(
    "UPDATE participants SET expires_at=?,token_hash=? WHERE id=?",
  )
    .bind(
      new Date().toISOString(),
      await hash(secret()),
      c.get("participant").id,
    )
    .run();
  return c.json({ status: "ok" });
});
async function registered(db: D1Database, appId: string, sessionId: string) {
  return db
    .prepare("SELECT origin,base_path FROM apps WHERE id=? AND session_id=?")
    .bind(appId, sessionId)
    .first<{ origin: string; base_path: string }>();
}
app.get("/v1/apps/:appId/feedback", async (c) => {
  const registeredApp = await registered(
    c.env.DB,
    c.req.param("appId"),
    c.get("participant").session_id,
  );
  if (!registeredApp) return c.json(error("NOT_FOUND", "Not found"), 404);
  let path: string;
  try {
    const page = pageIdentity(c.req.query("pageUrl") ?? "");
    path = normalizePath(c.req.query("path") ?? "");
    if (
      page.origin !== registeredApp.origin ||
      page.path !== path ||
      !withinBase(path, registeredApp.base_path)
    )
      throw new Error();
  } catch {
    return c.json(error("FORBIDDEN", "Page denied"), 403);
  }
  const result = await c.env.DB.prepare(
    "SELECT id,selector,tag_name,text_snippet,rect_json,category,comment,created_at FROM feedback WHERE app_id=? AND page_path=? ORDER BY created_at DESC,id DESC LIMIT 500",
  )
    .bind(c.req.param("appId"), path)
    .all<{
      id: string;
      selector: string;
      tag_name: string;
      text_snippet: string;
      rect_json: string;
      category: string;
      comment: string;
      created_at: string;
    }>();
  return c.json({
    items: result.results.reverse().map((r) => ({
      id: r.id,
      target: {
        selector: r.selector,
        tagName: r.tag_name,
        textSnippet: r.text_snippet,
        rect: JSON.parse(r.rect_json),
      },
      category: r.category,
      comment: r.comment,
      createdAt: r.created_at,
    })),
  });
});
app.post("/v1/apps/:appId/feedback", async (c) => {
  const registeredApp = await registered(
    c.env.DB,
    c.req.param("appId"),
    c.get("participant").session_id,
  );
  if (!registeredApp) return c.json(error("NOT_FOUND", "Not found"), 404);
  const parsed = feedbackSchema.safeParse(c.get("body"));
  if (!parsed.success)
    return c.json(error("VALIDATION_ERROR", "Invalid feedback"), 400);
  const data = parsed.data;
  const page = pageIdentity(data.pageUrl);
  if (
    page.origin !== registeredApp.origin ||
    !withinBase(page.path, registeredApp.base_path)
  )
    return c.json(error("FORBIDDEN", "Page denied"), 403);
  const id = crypto.randomUUID(),
    createdAt = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO feedback(id,app_id,author_id,page_path,selector,tag_name,text_snippet,rect_json,category,comment,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      c.req.param("appId"),
      c.get("participant").id,
      page.path,
      data.target.selector,
      data.target.tagName,
      data.target.textSnippet,
      JSON.stringify(data.target.rect),
      data.category,
      data.comment,
      createdAt,
    )
    .run();
  return c.json({ id, createdAt }, 201);
});
export default app;
