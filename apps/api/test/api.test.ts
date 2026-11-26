import { applyD1Migrations, env, fetchMock } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app, { hash } from "../src/index";
import { generateKeyPair, exportJWK, SignJWT, type JWTPayload } from "jose";
import { pkceChallenge } from "../src/crypto";
const googleEnv = {
  DEFAULT_SESSION_ID: "s1",
  DEFAULT_APP_ID: "a1",
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
};
let signingKey: CryptoKey;
const origin = `chrome-extension://${"a".repeat(32)}`;
const invite = "i".repeat(64),
  admin = "a".repeat(64);
async function request(
  path: string,
  options: {
    token?: string;
    body?: unknown;
    origin?: string;
    method?: string;
    ip?: string;
  } = {},
) {
  return app.request(
    `http://local${path}`,
    {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers: {
        Origin: options.origin ?? origin,
        "CF-Connecting-IP": options.ip ?? "127.0.0.1",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
    { DB: env.DB, EXTENSION_ORIGINS: origin, ...googleEnv },
  );
}
async function prepareLogin(
  session = "s1",
  claims: JWTPayload = {},
  fixed = false,
) {
  const verifier = "v".repeat(64),
    redirectUri = `https://${"a".repeat(32)}.chromiumapp.org/google`;
  const r = await request(
    fixed ? "/v1/auth/google/start" : `/v1/sessions/${session}/google/start`,
    {
      body: {
        ...(fixed
          ? {}
          : { inviteCode: invite, displayName: "Untrusted client name" }),
        redirectUri,
        codeChallenge: await pkceChallenge(verifier),
      },
    },
  );
  expect(r.status).toBe(201);
  const flow = (await r.json()) as { flowId: string; authorizationUrl: string };
  const url = new URL(flow.authorizationUrl),
    now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    iss: "https://accounts.google.com",
    aud: googleEnv.GOOGLE_CLIENT_ID,
    sub: "verified-test-google-user",
    name: "Google Account Name",
    iat: now,
    exp: now + 3600,
    nonce: url.searchParams.get("nonce"),
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-google-key" })
    .sign(signingKey);
  return {
    jwt,
    flow,
    url,
    completion: {
      flowId: flow.flowId,
      state: url.searchParams.get("state"),
      code: "test-google-code",
      codeVerifier: verifier,
    },
  };
}
function mockToken(jwt: string) {
  fetchMock
    .get("https://oauth2.googleapis.com")
    .intercept({ path: "/token", method: "POST" })
    .reply(200, {
      id_token: jwt,
      access_token: "discarded-google-access-token",
    });
}
async function join(session = "s1") {
  const login = await prepareLogin(session);
  mockToken(login.jwt);
  const r = await request(`/v1/sessions/${session}/join`, {
    body: login.completion,
  });
  expect(r.status).toBe(201);
  return (await r.json()) as {
    token: string;
    participantId: string;
    expiresAt: string;
    authProvider: string;
  };
}
const input = {
  pageUrl: "https://example.com/app/settings?private=discard#ignore",
  target: {
    selector: "html > body:nth-of-type(1) > button:nth-of-type(1)",
    tagName: "BUTTON",
    textSnippet: "Save",
    rect: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
  },
  category: "suggestion",
  comment: "Please improve",
};
const route = "/v1/apps/a1/feedback";
const query = (
  url = "https://example.com/app/settings",
  path = "/app/settings",
) => `?${new URLSearchParams({ pageUrl: url, path })}`;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  fetchMock.activate();
  fetchMock.disableNetConnect();
  const pair = await generateKeyPair("RS256", { extractable: true });
  signingKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  fetchMock
    .get("https://www.googleapis.com")
    .intercept({ path: "/oauth2/v3/certs", method: "GET" })
    .reply(200, {
      keys: [{ ...jwk, kid: "test-google-key", alg: "RS256", use: "sig" }],
    })
    .persist();
});
beforeEach(async () => {
  await env.DB.batch(
    [
      "DELETE FROM google_login_flows",
      "DELETE FROM feedback",
      "DELETE FROM participants",
      "DELETE FROM apps",
      "DELETE FROM sessions",
      "DELETE FROM request_limits",
    ].map((sql) => env.DB.prepare(sql)),
  );
  for (const id of ["s1", "s2"])
    await env.DB.prepare(
      "INSERT INTO sessions(id,name,invite_secret_hash,admin_secret_hash,expires_at) VALUES(?,?,?,?,?)",
    )
      .bind(
        id,
        id,
        await hash(invite),
        await hash(admin),
        new Date(Date.now() + 86400000).toISOString(),
      )
      .run();
  await env.DB.prepare(
    "INSERT INTO apps(id,session_id,name,origin,base_path) VALUES(?,?,?,?,?)",
  )
    .bind("a1", "s1", "App", "https://example.com", "/app")
    .run();
});
describe("Workers runtime + real D1", () => {
  it("fixed login chooses the server destination and verified Google name; logout and relogin work", async () => {
    const login = await prepareLogin("s1", {}, true);
    expect(login.url.searchParams.get("scope")).toBe("openid profile");
    mockToken(login.jwt);
    const response = await request("/v1/auth/google/join", {
      body: login.completion,
    });
    expect(response.status).toBe(201);
    const user = (await response.json()) as {
      token: string;
      participantId: string;
      displayName: string;
      sessionId: string;
      appId: string;
    };
    expect(user).toMatchObject({
      displayName: "Google Account Name",
      sessionId: "s1",
      appId: "a1",
    });
    const row = await env.DB.prepare(
      "SELECT display_name FROM participants WHERE id=?",
    )
      .bind(user.participantId)
      .first();
    expect(row?.display_name).toBe("Google Account Name");
    expect(
      (await request(route, { token: user.token, body: input })).status,
    ).toBe(201);
    expect(
      (
        await request("/v1/participants/logout", {
          token: user.token,
          body: {},
        })
      ).status,
    ).toBe(200);
    expect((await request(route + query(), { token: user.token })).status).toBe(
      401,
    );
    const again = await prepareLogin("s1", {}, true);
    mockToken(again.jwt);
    const r = await request("/v1/auth/google/join", { body: again.completion });
    expect(r.status).toBe(201);
    const next = (await r.json()) as { token: string };
    expect(next.token).not.toBe(user.token);
    const comments = (await (
      await request(route + query(), { token: next.token })
    ).json()) as { items: unknown[] };
    expect(comments.items).toHaveLength(1);
  });
  it("fixed login rejects client destinations and missing, mismatched or expired server destinations", async () => {
    const body = {
      redirectUri: "https://" + "a".repeat(32) + ".chromiumapp.org/google",
      codeChallenge: await pkceChallenge("v".repeat(64)),
    };
    for (const extra of [
      { sessionId: "s2" },
      { appId: "other" },
      { displayName: "Spoofed" },
      { inviteCode: invite },
    ])
      expect(
        (
          await request("/v1/auth/google/start", {
            body: { ...body, ...extra },
          })
        ).status,
      ).toBe(400);
    for (const config of [
      { DEFAULT_SESSION_ID: undefined },
      { DEFAULT_APP_ID: undefined },
      { DEFAULT_APP_ID: "absent" },
      { DEFAULT_SESSION_ID: "s2" },
    ]) {
      const response = await app.request(
        "http://local/v1/auth/google/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify(body),
        },
        { DB: env.DB, EXTENSION_ORIGINS: origin, ...googleEnv, ...config },
      );
      expect(response.status).toBe(503);
    }
    const flow = await prepareLogin("s1", {}, true);
    await env.DB.prepare(
      "UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id='s1'",
    ).run();
    expect((await request("/v1/auth/google/start", { body })).status).toBe(503);
    expect(
      (await request("/v1/auth/google/join", { body: flow.completion })).status,
    ).toBe(503);
    expect(
      (await env.DB.prepare("SELECT count(*) AS n FROM participants").first())
        ?.n,
    ).toBe(0);
  });
  it("does not trust legacy client names and handles absent Google profile names", async () => {
    for (const name of ["Google Verified", undefined, " "]) {
      const login = await prepareLogin("s1", { name });
      mockToken(login.jwt);
      const response = await request("/v1/sessions/s1/join", {
        body: login.completion,
      });
      expect(response.status).toBe(201);
      const user = (await response.json()) as { displayName: string };
      expect(user.displayName).toBe(
        name === "Google Verified" ? name : "Googleユーザー",
      );
    }
  });

  it("health and explicit extension preflight", async () => {
    expect((await request("/health")).status).toBe(200);
    expect(
      (await request("/health", { origin: "https://evil.example" })).status,
    ).toBe(403);
    const r = await app.request(
      "http://local/v1/apps/a1/feedback",
      {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      },
      { DB: env.DB, EXTENSION_ORIGINS: origin, ...googleEnv },
    );
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(
      (
        await request("/health", {
          origin: `chrome-extension://${"b".repeat(32)}`,
        })
      ).status,
    ).toBe(403);
  });
  it("two reviewers share only the exact registered route; hashes only at rest", async () => {
    const a = await join(),
      b = await join();
    expect(a.token).not.toBe(b.token);
    const stored = await env.DB.prepare(
      "SELECT token_hash FROM participants WHERE id=?",
    )
      .bind(a.participantId)
      .first<{ token_hash: string }>();
    expect(stored?.token_hash).toBe(await hash(a.token));
    expect(stored?.token_hash).not.toBe(a.token);
    const post = await request(route, { token: a.token, body: input });
    expect(post.status).toBe(201);
    const read = await request(route + query(), { token: b.token });
    expect(read.status).toBe(200);
    const body = (await read.json()) as { items: { comment: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].comment).toBe(input.comment);
    expect(
      await (
        await request(
          route + query("https://example.com/app/other", "/app/other"),
          { token: b.token },
        )
      ).json(),
    ).toEqual({ items: [] });
    const row = await env.DB.prepare("SELECT page_path FROM feedback").first<{
      page_path: string;
    }>();
    expect(row?.page_path).toBe("/app/settings");
  });
  it("rejects anonymous, cross-session, invite/admin and expired credentials", async () => {
    expect((await request(route + query())).status).toBe(401);
    for (const token of [invite, admin])
      expect((await request(route + query(), { token })).status).toBe(401);
    const outsider = await join("s2");
    expect(
      (await request(route + query(), { token: outsider.token })).status,
    ).toBe(404);
    expect(
      (await request(route, { token: outsider.token, body: input })).status,
    ).toBe(404);
    const a = await join();
    await env.DB.prepare("UPDATE participants SET expires_at=? WHERE id=?")
      .bind("2000-01-01T00:00:00.000Z", a.participantId)
      .run();
    expect((await request(route + query(), { token: a.token })).status).toBe(
      401,
    );
  });
  it("expires sessions and rejects invalid join credentials", async () => {
    for (const inviteCode of ["wrong", admin])
      expect(
        (
          await request("/v1/sessions/s1/join", {
            body: { inviteCode, displayName: "X" },
          })
        ).status,
      ).toBe(401);
    const a = await join();
    await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE id=?")
      .bind("2000-01-01T00:00:00.000Z", "s1")
      .run();
    expect((await request(route + query(), { token: a.token })).status).toBe(
      401,
    );
    expect(
      (
        await request("/v1/sessions/s1/join", {
          body: { inviteCode: invite, displayName: "X" },
        })
      ).status,
    ).toBe(401);
  });
  it("denies wrong origin, base path, traversal and mismatched read URLs", async () => {
    const a = await join();
    for (const pageUrl of [
      "https://evil.com/app/settings",
      "https://example.com/application",
      "https://example.com/app/../private",
      "https://example.com/app%2fprivate",
    ])
      expect([400, 403]).toContain(
        (await request(route, { token: a.token, body: { ...input, pageUrl } }))
          .status,
      );
    for (const [url, path] of [
      ["https://evil.com/app/settings", "/app/settings"],
      ["https://example.com/private", "/private"],
      ["https://example.com/app/one", "/app/two"],
    ])
      expect(
        (await request(route + query(url, path), { token: a.token })).status,
      ).toBe(403);
  });
  it("bounds bodies and validates unknown fields, target, categories and comments", async () => {
    const a = await join();
    for (const body of [
      { ...input, comment: "" },
      { ...input, comment: "x".repeat(2001) },
      { ...input, role: "admin" },
      { ...input, target: { ...input.target, tagName: "INPUT" } },
      { ...input, target: { ...input.target, value: "secret" } },
      { ...input, category: "other" },
    ])
      expect((await request(route, { token: a.token, body })).status).toBe(400);
    expect(
      (
        await request(route, {
          token: a.token,
          body: { ...input, comment: "x".repeat(17000) },
        })
      ).status,
    ).toBe(413);
  });
  it("rate limits join attempts across sessions", async () => {
    for (let i = 0; i < 10; i++)
      expect(
        (
          await request("/v1/sessions/nonexistent/join", {
            body: { inviteCode: "bad", displayName: "X" },
          })
        ).status,
      ).toBe(401);
    const response = await request("/v1/sessions/s1/join", {
      body: { inviteCode: invite, displayName: "X" },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });
  it("stores hostile comments as data and parameterizes SQL", async () => {
    const a = await join();
    const comment = "<img src=x onerror=alert(1)> '); DROP TABLE sessions;--";
    expect(
      (await request(route, { token: a.token, body: { ...input, comment } }))
        .status,
    ).toBe(201);
    const row = await env.DB.prepare("SELECT comment FROM feedback").first<{
      comment: string;
    }>();
    expect(row?.comment).toBe(comment);
    expect(
      (
        await env.DB.prepare("SELECT count(*) as n FROM sessions").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(2);
  });
  it("rejects malformed JSON, invalid UTF-8 and non-JSON media types", async () => {
    const a = await join();
    for (const [body, contentType] of [
      ["{", "application/json"],
      ["{}", "text/plain"],
      ["{}", "application/json-unsafe"],
      [new Uint8Array([0xff]), "application/json"],
    ] as const) {
      const response = await app.request(
        `http://local${route}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${a.token}`,
            "Content-Type": contentType,
          },
          body,
        },
        { DB: env.DB, EXTENSION_ORIGINS: origin, ...googleEnv },
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
  it("limits authenticated traffic and distributed joins into the same session", async () => {
    const a = await join();
    const window = Math.floor(Date.now() / 60000);
    for (const time of [window, window + 1]) {
      for (const [identity, attempts] of [
        [`participant:${a.participantId}`, 120],
        ["join:session:s1", 60],
      ] as const) {
        await env.DB.prepare(
          "INSERT OR REPLACE INTO request_limits(bucket,attempts,expires_at) VALUES(?,?,?)",
        )
          .bind(await hash(`${identity}:${time}`), attempts, (time + 2) * 60000)
          .run();
      }
    }
    expect((await request(route + query(), { token: a.token })).status).toBe(
      429,
    );
    expect(
      (
        await request("/v1/sessions/s1/join", {
          ip: "another-ip",
          body: { inviteCode: invite, displayName: "X" },
        })
      ).status,
    ).toBe(429);
  });
  it("rejects attribute selectors and secret-bearing metadata", async () => {
    const a = await join();
    for (const target of [
      { ...input.target, selector: 'button[data-secret="private"]' },
      { ...input.target, selector: 'input[value="password"]' },
      { ...input.target, rect: { x: 2, y: 0, width: 1, height: 1 } },
      { ...input.target, textSnippet: "x".repeat(121) },
    ]) {
      expect(
        (await request(route, { token: a.token, body: { ...input, target } }))
          .status,
      ).toBe(400);
    }
    expect(
      (
        await env.DB.prepare("SELECT count(*) AS n FROM feedback").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });
  it("does not preflight unsupported methods, headers or ordinary site origins", async () => {
    const headersList: Record<string, string>[] = [
      { Origin: origin, "Access-Control-Request-Method": "DELETE" },
      {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "cookie",
      },
      { Origin: "null", "Access-Control-Request-Method": "GET" },
      { Origin: "https://example.com", "Access-Control-Request-Method": "GET" },
    ];
    for (const headers of headersList) {
      const response = await app.request(
        "http://local" + route,
        { method: "OPTIONS", headers },
        { DB: env.DB, EXTENSION_ORIGINS: origin, ...googleEnv },
      );
      expect(response.status).toBe(403);
    }
  });
  it("requires Google login and rejects legacy anonymous participant tokens", async () => {
    const old = "c".repeat(64);
    await env.DB.prepare(
      "INSERT INTO participants(id,session_id,display_name,token_hash,expires_at) VALUES(?,?,?,?,?)",
    )
      .bind(
        "legacy",
        "s1",
        "Old reviewer",
        await hash(old),
        "2099-01-01T00:00:00.000Z",
      )
      .run();
    expect((await request(route + query(), { token: old })).status).toBe(401);
    expect(
      (
        await request("/v1/sessions/s1/join", {
          body: { inviteCode: invite, displayName: "Old" },
        })
      ).status,
    ).toBe(401);
  });
  it("stores only hashed Google identity and one-use state, with no Google tokens", async () => {
    const login = await prepareLogin();
    const flow = await env.DB.prepare(
      "SELECT * FROM google_login_flows WHERE id=?",
    )
      .bind(login.flow.flowId)
      .first();
    expect(JSON.stringify(flow)).not.toContain(login.completion.state);
    expect(JSON.stringify(flow)).not.toContain(
      login.url.searchParams.get("nonce"),
    );
    mockToken(login.jwt);
    const r = await request("/v1/sessions/s1/join", { body: login.completion });
    expect(r.status).toBe(201);
    const result = (await r.json()) as {
      participantId: string;
      authProvider: string;
    };
    expect(result.authProvider).toBe("google");
    const participant = await env.DB.prepare(
      "SELECT * FROM participants WHERE id=?",
    )
      .bind(result.participantId)
      .first<{ google_subject_hash: string }>();
    expect(participant?.google_subject_hash).toBe(
      await hash("google:verified-test-google-user"),
    );
    expect(JSON.stringify(participant)).not.toContain(login.jwt);
    expect(JSON.stringify(participant)).not.toContain(
      "discarded-google-access-token",
    );
    expect(
      (await request("/v1/sessions/s1/join", { body: login.completion }))
        .status,
    ).toBe(401);
  });
  it("rejects state/PKCE mismatch without consuming the legitimate flow", async () => {
    const login = await prepareLogin();
    for (const completion of [
      { ...login.completion, state: "f".repeat(64) },
      { ...login.completion, codeVerifier: "x".repeat(64) },
    ])
      expect(
        (await request("/v1/sessions/s1/join", { body: completion })).status,
      ).toBe(401);
    expect(
      await env.DB.prepare("SELECT id FROM google_login_flows WHERE id=?")
        .bind(login.flow.flowId)
        .first(),
    ).not.toBeNull();
    mockToken(login.jwt);
    expect(
      (await request("/v1/sessions/s1/join", { body: login.completion }))
        .status,
    ).toBe(201);
  });
  it("rejects invalid Google issuer, audience, nonce, expiry and signature", async () => {
    for (const claims of [
      { iss: "https://evil.example" },
      { aud: "another-client.apps.googleusercontent.com" },
      { nonce: "incorrect" },
      { exp: Math.floor(Date.now() / 1000) - 120 },
      { azp: "another-client.apps.googleusercontent.com" },
    ]) {
      const login = await prepareLogin("s1", claims);
      mockToken(login.jwt);
      expect(
        (await request("/v1/sessions/s1/join", { body: login.completion }))
          .status,
      ).toBe(401);
    }
    const login = await prepareLogin();
    mockToken(login.jwt.slice(0, -10) + "AAAAAAAAAA");
    expect(
      (await request("/v1/sessions/s1/join", { body: login.completion }))
        .status,
    ).toBe(401);
    expect(
      (
        await env.DB.prepare("SELECT count(*) AS n FROM participants").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });
  it("rejects expired flows, wrong sessions, and invites revoked during Google login", async () => {
    const expired = await prepareLogin();
    await env.DB.prepare(
      "UPDATE google_login_flows SET expires_at=0 WHERE id=?",
    )
      .bind(expired.flow.flowId)
      .run();
    expect(
      (await request("/v1/sessions/s1/join", { body: expired.completion }))
        .status,
    ).toBe(401);
    const login = await prepareLogin();
    expect(
      (await request("/v1/sessions/s2/join", { body: login.completion }))
        .status,
    ).toBe(401);
    await env.DB.prepare("UPDATE sessions SET invite_secret_hash=? WHERE id=?")
      .bind(await hash("revoked"), "s1")
      .run();
    mockToken(login.jwt);
    expect(
      (await request("/v1/sessions/s1/join", { body: login.completion }))
        .status,
    ).toBe(401);
  });
  it("rejects arbitrary redirect origins and fails closed without OAuth settings", async () => {
    for (const redirectUri of [
      "https://evil.example/google",
      `https://${"b".repeat(32)}.chromiumapp.org/google`,
      `https://${"a".repeat(32)}.chromiumapp.org/google?next=evil`,
    ]) {
      expect(
        (
          await request("/v1/sessions/s1/google/start", {
            body: {
              inviteCode: invite,
              displayName: "X",
              redirectUri,
              codeChallenge: await pkceChallenge("v".repeat(64)),
            },
          })
        ).status,
      ).toBe(403);
    }
    const r = await app.request(
      "http://local/v1/sessions/s1/join",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: invite, displayName: "X" }),
      },
      { DB: env.DB, EXTENSION_ORIGINS: origin },
    );
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
      "AUTH_NOT_CONFIGURED",
    );
  });
  it("revokes the app token at logout without deleting comments", async () => {
    const a = await join();
    expect((await request(route, { token: a.token, body: input })).status).toBe(
      201,
    );
    expect(
      (await request("/v1/participants/logout", { token: a.token, body: {} }))
        .status,
    ).toBe(200);
    expect((await request(route + query(), { token: a.token })).status).toBe(
      401,
    );
    expect(
      (
        await env.DB.prepare("SELECT count(*) AS n FROM feedback").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
  });
});
