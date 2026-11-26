import { fixedGoogleSessionSchema } from "@app-feedback/shared";
export class GoogleLoginError extends Error {
  constructor(readonly kind: "setup" | "cancel" | "invalid") {
    super(`Google login ${kind}`);
  }
}
type Post = (
  base: string,
  path: string,
  token: undefined,
  body: unknown,
) => Promise<unknown>;
export async function joinWithGoogle(base: string, post: Post) {
  const redirectUri = chrome.identity.getRedirectURL("google");
  const codeVerifier = Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(codeVerifier),
    ),
  );
  const codeChallenge = btoa(String.fromCharCode(...digest))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const result = await post(base, "/v1/auth/google/start", undefined, {
    redirectUri,
    codeChallenge,
  });
  if (
    typeof result !== "object" ||
    !result ||
    !("flowId" in result) ||
    typeof result.flowId !== "string" ||
    !("authorizationUrl" in result) ||
    typeof result.authorizationUrl !== "string"
  )
    throw new GoogleLoginError("invalid");
  const authorization = new URL(result.authorizationUrl);
  const state = authorization.searchParams.get("state");
  if (
    authorization.origin !== "https://accounts.google.com" ||
    authorization.pathname !== "/o/oauth2/v2/auth" ||
    authorization.username ||
    authorization.password ||
    authorization.hash ||
    authorization.searchParams.get("redirect_uri") !== redirectUri ||
    authorization.searchParams.get("response_type") !== "code" ||
    authorization.searchParams.get("scope") !== "openid profile" ||
    authorization.searchParams.get("code_challenge") !== codeChallenge ||
    authorization.searchParams.get("code_challenge_method") !== "S256" ||
    !state ||
    !/^[a-f0-9]{64}$/.test(state)
  )
    throw new GoogleLoginError("invalid");
  let callback: string | undefined;
  try {
    callback = await chrome.identity.launchWebAuthFlow({
      url: authorization.toString(),
      interactive: true,
    });
  } catch {
    throw new GoogleLoginError("cancel");
  }
  if (!callback) throw new GoogleLoginError("cancel");
  const returned = new URL(callback),
    expected = new URL(redirectUri);
  if (
    returned.origin !== expected.origin ||
    returned.pathname !== expected.pathname ||
    returned.username ||
    returned.password ||
    returned.hash ||
    returned.searchParams.has("error") ||
    returned.searchParams.getAll("state").length !== 1 ||
    returned.searchParams.get("state") !== state ||
    returned.searchParams.getAll("code").length !== 1
  )
    throw new GoogleLoginError("invalid");
  const code = returned.searchParams.get("code");
  if (!code || code.length > 2048) throw new GoogleLoginError("invalid");
  return fixedGoogleSessionSchema.parse(
    await post(base, "/v1/auth/google/join", undefined, {
      flowId: result.flowId,
      state,
      code,
      codeVerifier,
    }),
  );
}
