import { Hono, type MiddlewareHandler } from "hono";
import {
  feedbackSchema,
  pageIdentity,
  siteFeedbackQuerySchema,
  logoutSchema,
} from "@app-feedback/shared";
import { googleConfig, type GoogleBindings } from "./google-auth";
import { hash, secret } from "./crypto";
import { budget } from "./rate-limit";

type SiteEnv = {
  Bindings: GoogleBindings & { DB: D1Database };
  Variables: { body: unknown; participant: { id: string } };
};
const error = (code: string, message: string) => ({ error: { code, message } });
const auth: MiddlewareHandler<SiteEnv> = async (c, next) => {
  googleConfig(c.env);
  const token = /^Bearer ([a-f0-9]{64})$/.exec(
    c.req.header("Authorization") ?? "",
  )?.[1];
  const participant = token
    ? await c.env.DB.prepare(
        "SELECT id FROM site_participants WHERE token_hash=? AND expires_at>?",
      )
        .bind(await hash(token), new Date().toISOString())
        .first<{ id: string }>()
    : null;
  if (!participant)
    return c.json(error("UNAUTHORIZED", "Google login required"), 401);
  if (!(await budget(c.env.DB, `site-participant:${participant.id}`, 120))) {
    c.header("Retry-After", "60");
    return c.json(error("RATE_LIMITED", "Try again later"), 429);
  }
  c.set("participant", participant);
  await next();
};
export const siteAuthRoutes = new Hono<SiteEnv>();
siteAuthRoutes.post("/logout", auth, async (c) => {
  if (!logoutSchema.safeParse(c.get("body")).success)
    return c.json(error("VALIDATION_ERROR", "Invalid logout request"), 400);
  await c.env.DB.prepare(
    "UPDATE site_participants SET expires_at=?,token_hash=? WHERE id=?",
  )
    .bind(
      new Date().toISOString(),
      await hash(secret()),
      c.get("participant").id,
    )
    .run();
  return c.json({ status: "ok" });
});
export const siteRoutes = new Hono<SiteEnv>();
siteRoutes.use("*", auth);
siteRoutes.get("/feedback", async (c) => {
  const queries = c.req.queries();
  const parsed = siteFeedbackQuerySchema.safeParse(c.req.query());
  if (
    !parsed.success ||
    Object.values(queries).some((values) => values.length !== 1)
  )
    return c.json(error("VALIDATION_ERROR", "Invalid page URL"), 400);
  const page = pageIdentity(parsed.data.pageUrl);
  // Empty reads do not register sites or persist browsing history.
  const result = await c.env.DB.prepare(
    "SELECT f.id,f.selector,f.tag_name,f.text_snippet,f.rect_json,f.category,f.comment,f.created_at,p.display_name AS author_name FROM site_feedback f JOIN sites s ON s.id=f.site_id JOIN site_participants p ON p.id=f.author_id WHERE s.origin=? AND f.page_path=? ORDER BY f.created_at DESC,f.id DESC LIMIT 500",
  )
    .bind(page.origin, page.path)
    .all<{
      id: string;
      selector: string;
      tag_name: string;
      text_snippet: string;
      rect_json: string;
      category: string;
      comment: string;
      created_at: string;
      author_name: string;
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
      authorName: r.author_name,
    })),
  });
});
siteRoutes.post("/feedback", async (c) => {
  const parsed = feedbackSchema.safeParse(c.get("body"));
  if (!parsed.success)
    return c.json(error("VALIDATION_ERROR", "Invalid feedback"), 400);
  const data = parsed.data,
    page = pageIdentity(data.pageUrl);
  const id = crypto.randomUUID(),
    createdAt = new Date().toISOString();
  // UNIQUE origin + a transaction makes concurrent first posts share one site.
  // The server derives site identity; no client site ID, role or owner is trusted.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO sites(id,origin) VALUES(?,?) ON CONFLICT(origin) DO NOTHING",
    ).bind(crypto.randomUUID(), page.origin),
    c.env.DB.prepare(
      "INSERT INTO site_feedback(id,site_id,author_id,page_path,selector,tag_name,text_snippet,rect_json,category,comment,created_at) VALUES(?,(SELECT id FROM sites WHERE origin=?),?,?,?,?,?,?,?,?,?)",
    ).bind(
      id,
      page.origin,
      c.get("participant").id,
      page.path,
      data.target.selector,
      data.target.tagName,
      data.target.textSnippet,
      JSON.stringify(data.target.rect),
      data.category,
      data.comment,
      createdAt,
    ),
  ]);
  return c.json({ id, createdAt }, 201);
});
