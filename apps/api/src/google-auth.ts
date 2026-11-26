import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  googleStartSchema,
  googleJoinSchema,
  fixedGoogleStartSchema,
} from "@app-feedback/shared";
import { hash, secret, pkceChallenge } from "./crypto";
export type GoogleBindings = {
  DEFAULT_SESSION_ID?: string;
  DEFAULT_APP_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  EXTENSION_ORIGINS: string;
};
export class GoogleAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 401 | 403 | 503,
    message: string,
  ) {
    super(message);
  }
}
export function googleConfig(env: GoogleBindings) {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(
      env.GOOGLE_CLIENT_ID,
    ) ||
    !env.GOOGLE_CLIENT_SECRET?.trim()
  )
    throw new GoogleAuthError(
      "AUTH_NOT_CONFIGURED",
      503,
      "Google login is not configured",
    );
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}
const keys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 5000, cacheMaxAge: 600000 },
);
function unauthorized(): never {
  throw new GoogleAuthError(
    "UNAUTHORIZED",
    401,
    "Invalid Google login or invitation",
  );
}
function validRedirect(env: GoogleBindings, raw: string, origin?: string) {
  const url = new URL(raw);
  const id = /^([a-p]{32})\.chromiumapp\.org$/.exec(url.hostname)?.[1];
  if (
    !id ||
    raw !== `https://${id}.chromiumapp.org/google` ||
    !env.EXTENSION_ORIGINS.split(",")
      .map((s) => s.trim())
      .includes(`chrome-extension://${id}`) ||
    (origin && origin !== `chrome-extension://${id}`)
  )
    throw new GoogleAuthError("FORBIDDEN", 403, "Redirect denied");
  return raw;
}
export async function startGoogleLogin(
  db: D1Database,
  env: GoogleBindings,
  sessionId: string,
  body: unknown,
  origin?: string,
  fixed = false,
) {
  const config = googleConfig(env);
  const parsed = (fixed ? fixedGoogleStartSchema : googleStartSchema).safeParse(
    body,
  );
  if (!parsed.success)
    throw new GoogleAuthError(
      "VALIDATION_ERROR",
      400,
      "Invalid Google login request",
    );
  const data = parsed.data,
    redirectUri = validRedirect(env, data.redirectUri, origin);
  const now = Date.now();
  const session = fixed
    ? await db
        .prepare(
          "SELECT invite_secret_hash FROM sessions WHERE id=? AND expires_at>?",
        )
        .bind(sessionId, new Date(now).toISOString())
        .first<{ invite_secret_hash: string }>()
    : await db
        .prepare(
          "SELECT invite_secret_hash FROM sessions WHERE id=? AND invite_secret_hash=? AND expires_at>?",
        )
        .bind(
          sessionId,
          await hash(googleStartSchema.parse(body).inviteCode),
          new Date(now).toISOString(),
        )
        .first<{ invite_secret_hash: string }>();
  if (!session) unauthorized();
  const inviteHash = session.invite_secret_hash;
  await db
    .prepare("DELETE FROM google_login_flows WHERE expires_at<=?")
    .bind(now)
    .run();
  const flowId = crypto.randomUUID(),
    state = secret(),
    nonce = secret();
  await db
    .prepare(
      "INSERT INTO google_login_flows(id,session_id,invite_secret_hash,display_name,redirect_uri,state_hash,nonce_hash,code_challenge,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      flowId,
      sessionId,
      inviteHash,
      "",
      redirectUri,
      await hash(state),
      await hash(nonce),
      data.codeChallenge,
      now + 5 * 60000,
    )
    .run();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile",
    state,
    nonce,
    code_challenge: data.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { flowId, authorizationUrl: url.toString() };
}
type Flow = {
  session_id: string;
  invite_secret_hash: string;
  redirect_uri: string;
  nonce_hash: string;
};
export async function completeGoogleLogin(
  db: D1Database,
  env: GoogleBindings,
  sessionId: string,
  body: unknown,
) {
  const config = googleConfig(env);
  const parsed = googleJoinSchema.safeParse(body);
  if (!parsed.success) {
    if (typeof body === "object" && body !== null && "inviteCode" in body)
      throw new GoogleAuthError(
        "GOOGLE_LOGIN_REQUIRED",
        401,
        "Google login required",
      );
    throw new GoogleAuthError(
      "VALIDATION_ERROR",
      400,
      "Invalid Google login completion",
    );
  }
  const data = parsed.data;
  // Single-use consumption is atomic across isolates; PKCE/state mismatches do
  // not consume a legitimate user's flow. No code/verifier/token is stored.
  const flow = await db
    .prepare(
      "DELETE FROM google_login_flows WHERE id=? AND session_id=? AND state_hash=? AND code_challenge=? AND expires_at>? RETURNING session_id,invite_secret_hash,redirect_uri,nonce_hash",
    )
    .bind(
      data.flowId,
      sessionId,
      await hash(data.state),
      await pkceChallenge(data.codeVerifier),
      Date.now(),
    )
    .first<Flow>();
  if (!flow) unauthorized();
  validRedirect(env, flow.redirect_uri);
  let googleSubject: string;
  let displayName: string;
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: data.code,
        code_verifier: data.codeVerifier,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: flow.redirect_uri,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) unauthorized();
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      !result ||
      !("id_token" in result) ||
      typeof result.id_token !== "string" ||
      result.id_token.length > 12000
    )
      unauthorized();
    const { payload } = await jwtVerify(result.id_token, keys, {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: config.clientId,
      requiredClaims: ["iss", "sub", "aud", "iat", "exp", "nonce"],
      maxTokenAge: "10m",
      clockTolerance: 30,
    });
    if (
      payload.aud !== config.clientId ||
      (payload.azp !== undefined && payload.azp !== config.clientId) ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      payload.sub.length > 255 ||
      typeof payload.nonce !== "string" ||
      (await hash(payload.nonce)) !== flow.nonce_hash
    )
      unauthorized();
    // Profile names are display data, never an authorization claim.
    displayName =
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim().slice(0, 80)
        : "Googleユーザー";
    googleSubject = await hash(`google:${payload.sub}`);
  } catch {
    unauthorized();
  }
  const now = new Date().toISOString();
  const session = await db
    .prepare(
      "SELECT expires_at FROM sessions WHERE id=? AND invite_secret_hash=? AND expires_at>?",
    )
    .bind(sessionId, flow.invite_secret_hash, now)
    .first<{ expires_at: string }>();
  if (!session) unauthorized();
  const token = secret(),
    id = crypto.randomUUID();
  const expiresAt = new Date(
    Math.min(Date.now() + 24 * 60 * 60 * 1000, Date.parse(session.expires_at)),
  ).toISOString();
  const inserted = await db
    .prepare(
      "INSERT INTO participants(id,session_id,display_name,token_hash,expires_at,google_subject_hash) SELECT ?,?,?,?,?,? FROM sessions WHERE id=? AND invite_secret_hash=? AND expires_at>?",
    )
    .bind(
      id,
      sessionId,
      displayName,
      await hash(token),
      expiresAt,
      googleSubject,
      sessionId,
      flow.invite_secret_hash,
      now,
    )
    .run();
  if (inserted.meta.changes !== 1) unauthorized();
  return {
    participantId: id,
    token,
    expiresAt,
    authProvider: "google" as const,
    displayName,
  };
}

export async function fixedDestination(db: D1Database, env: GoogleBindings) {
  if (!env.DEFAULT_SESSION_ID || !env.DEFAULT_APP_ID)
    throw new GoogleAuthError(
      "AUTH_NOT_CONFIGURED",
      503,
      "Login destination is not configured",
    );
  const app = await db
    .prepare(
      "SELECT a.id FROM apps a JOIN sessions s ON s.id=a.session_id WHERE a.id=? AND a.session_id=? AND s.expires_at>?",
    )
    .bind(env.DEFAULT_APP_ID, env.DEFAULT_SESSION_ID, new Date().toISOString())
    .first();
  if (!app)
    throw new GoogleAuthError(
      "AUTH_NOT_CONFIGURED",
      503,
      "Login destination is unavailable",
    );
  return { sessionId: env.DEFAULT_SESSION_ID, appId: env.DEFAULT_APP_ID };
}
