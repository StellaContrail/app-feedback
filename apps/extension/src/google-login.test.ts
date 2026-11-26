import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { joinWithGoogle } from "./google-login";
const redirect = `https://${"a".repeat(32)}.chromiumapp.org/google`,
  state = "e".repeat(64);
const launch = vi.fn(),
  post = vi.fn();
const session = {
  participantId: "00000000-0000-4000-8000-000000000001",
  token: "f".repeat(64),
  expiresAt: "2099-01-01T00:00:00.000Z",
  authProvider: "google",
  displayName: "Google Name",
  sessionId: "s1",
  appId: "a1",
};
beforeEach(() => {
  vi.stubGlobal("chrome", {
    identity: {
      getRedirectURL: vi.fn().mockReturnValue(redirect),
      launchWebAuthFlow: launch,
    },
  });
  launch.mockReset();
  post.mockReset();
  post.mockImplementation(async (_base, path, _token, body) => {
    if (path.endsWith("/google/start")) {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: "test-client.apps.googleusercontent.com",
        response_type: "code",
        scope: "openid profile",
        redirect_uri: redirect,
        state,
        nonce: "n".repeat(64),
        code_challenge: body.codeChallenge,
        code_challenge_method: "S256",
      }).toString();
      return {
        flowId: "00000000-0000-4000-8000-000000000002",
        authorizationUrl: url.toString(),
      };
    }
    return session;
  });
  launch.mockResolvedValue(`${redirect}?code=google-code&state=${state}`);
});
afterEach(() => vi.unstubAllGlobals());
const login = () => joinWithGoogle("http://localhost:8787", post);
it("uses an interactive Google-only flow and binds the returned code to PKCE/state", async () => {
  expect(await login()).toEqual(session);
  expect(launch).toHaveBeenCalledWith({
    interactive: true,
    url: expect.stringContaining(
      "https://accounts.google.com/o/oauth2/v2/auth?",
    ),
  });
  const initial = post.mock.calls[0][3],
    completion = post.mock.calls[1][3];
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(completion.codeVerifier),
    ),
  );
  expect(initial.codeChallenge).toBe(
    btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, ""),
  );
  expect(initial).not.toHaveProperty("inviteCode");
  expect(initial).not.toHaveProperty("displayName");
  expect(post.mock.calls[1][1]).toBe("/v1/auth/google/join");
  expect(completion.state).toBe(state);
  expect(completion.code).toBe("google-code");
  expect(completion).not.toHaveProperty("inviteCode");
  expect(completion).not.toHaveProperty("id_token");
});
it("does not finish login after cancellation or callback state/origin tampering", async () => {
  for (const callback of [
    undefined,
    `${redirect}?code=x&state=wrong`,
    `https://evil.example/google?code=x&state=${state}`,
    `${redirect}?code=x&code=y&state=${state}`,
    `${redirect}?error=access_denied&state=${state}`,
  ]) {
    post.mockClear();
    launch.mockResolvedValue(callback);
    await expect(login()).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
  }
});
it("never launches an arbitrary authorization provider", async () => {
  post.mockResolvedValue({
    flowId: "id",
    authorizationUrl: "https://evil.example/login",
  });
  await expect(login()).rejects.toThrow();
  expect(launch).not.toHaveBeenCalled();
});
it("rejects legacy sessions without a server-confirmed Google marker", async () => {
  const { authProvider: unused, ...legacy } = session;
  void unused;
  post.mockImplementation(async (_base, path, _token, body) => {
    if (path.endsWith("/google/start")) {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        response_type: "code",
        scope: "openid profile",
        redirect_uri: redirect,
        state,
        code_challenge: body.codeChallenge,
        code_challenge_method: "S256",
      }).toString();
      return { flowId: "id", authorizationUrl: url.toString() };
    }
    return legacy;
  });
  await expect(login()).rejects.toThrow();
});
