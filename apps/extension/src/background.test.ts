import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "./protocol";
import { apiBase } from "./protocol";
const config: Settings = {
  authProvider: "google",
  apiUrl: "http://localhost:8787",
  sessionId: "s1",
  appId: "a1",
  token: "b".repeat(64),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const get = vi.fn(),
  set = vi.fn(),
  clear = vi.fn(),
  executeScript = vi.fn();
const remove = vi.fn(),
  sendMessage = vi.fn().mockResolvedValue(undefined),
  getTab = vi.fn();
const state: Record<string, unknown> = {};
const fetchMock = vi.fn();
const launchGoogle = vi.fn();
const googleRedirect = "https://" + "a".repeat(32) + ".chromiumapp.org/google";
let handle: (typeof import("./background"))["handle"];
const popup = {
  id: "extension-id",
  url: "chrome-extension://extension-id/popup.html",
};
const page = {
  id: "extension-id",
  url: "https://example.com/app?secret=x",
  frameId: 0,
  tab: { id: 1 } as chrome.tabs.Tab,
};
beforeAll(async () => {
  vi.stubGlobal("chrome", {
    identity: {
      getRedirectURL: () => googleRedirect,
      launchWebAuthFlow: launchGoogle,
    },
    storage: { session: { setAccessLevel: vi.fn(), get, set, clear, remove } },
    runtime: {
      id: "extension-id",
      getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      onMessage: { addListener: vi.fn() },
    },
    tabs: {
      get: getTab,
      sendMessage,
      onUpdated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
      query: vi
        .fn()
        .mockResolvedValue([{ id: 1, url: "https://example.com/app" }]),
    },
    scripting: { executeScript },
  });
  vi.stubGlobal("fetch", fetchMock);
  handle = (await import("./background")).handle;
});
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(state)) delete state[key];
  state.settings = config;
  get.mockImplementation(async (key: string) => ({ [key]: state[key] }));
  set.mockImplementation(async (value: Record<string, unknown>) => {
    Object.assign(state, value);
  });
  remove.mockImplementation(async (key: string) => {
    delete state[key];
  });
  clear.mockImplementation(async () => {
    for (const key of Object.keys(state)) delete state[key];
  });
  getTab.mockResolvedValue({
    id: 1,
    url: "https://example.com/app",
    status: "complete",
  });
  executeScript.mockResolvedValue([]);
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ items: [] }), {
        headers: { "Content-Type": "application/json" },
      }),
  );
});
function mockFixedLogin() {
  const login = {
    participantId: "00000000-0000-4000-8000-000000000001",
    token: "f".repeat(64),
    expiresAt: "2099-01-01T00:00:00.000Z",
    authProvider: "google",
    displayName: "Verified Google Name",
    sessionId: "fixed-session",
    appId: "fixed-app",
  };
  fetchMock.mockImplementation(async (raw: string, init: RequestInit) => {
    if (raw.endsWith("/v1/auth/google/start")) {
      const body = JSON.parse(init.body as string) as { codeChallenge: string };
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({
        redirect_uri: googleRedirect,
        response_type: "code",
        scope: "openid profile",
        code_challenge: body.codeChallenge,
        code_challenge_method: "S256",
        state: "e".repeat(64),
      }).toString();
      return Response.json({
        flowId: "00000000-0000-4000-8000-000000000002",
        authorizationUrl: auth.toString(),
      });
    }
    return Response.json(
      raw.endsWith("/v1/auth/google/join") ? login : { status: "ok" },
    );
  });
  return login;
}
describe("trusted background transport", () => {
  it("stores only the server destination and Google name after input-free login", async () => {
    const login = mockFixedLogin();
    launchGoogle.mockResolvedValue(
      googleRedirect + "?code=test-code&state=" + "e".repeat(64),
    );
    await handle({ type: "join" }, popup);
    expect(state.settings).toMatchObject({
      apiUrl: "http://localhost:8787",
      sessionId: login.sessionId,
      appId: login.appId,
      displayName: login.displayName,
      token: login.token,
      authProvider: "google",
    });
    const start = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(Object.keys(start).sort()).toEqual(["codeChallenge", "redirectUri"]);
    expect(JSON.stringify(state)).not.toContain("test-code");
    await handle({ type: "forget" }, popup);
    expect(await handle({ type: "status" }, popup)).toEqual({ joined: false });
  });
  it("does not restore a pending Google login after logout", async () => {
    const login = mockFixedLogin();
    let finish!: (callback: string) => void;
    launchGoogle.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const joining = handle({ type: "join" }, popup);
    const rejected = expect(joining).rejects.toThrow("cancel");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await handle({ type: "forget" }, popup);
    finish(googleRedirect + "?code=test-code&state=" + "e".repeat(64));
    await rejected;
    expect(state.settings).toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:8787/v1/participants/logout",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer " + login.token,
        }),
      }),
    );
  });

  it("allows only local API origins without URL state", () => {
    expect(apiBase("http://localhost:8787")).toBe("http://localhost:8787");
    for (const raw of [
      "https://evil.example",
      "http://localhost.evil",
      "http://u:p@localhost",
      "http://localhost/path",
      "http://localhost?token=x",
    ])
      expect(() => apiBase(raw)).toThrow();
  });
  it("restricts join, activation and forgetting to the extension popup", async () => {
    await expect(handle({ type: "activate" }, page)).rejects.toThrow(
      "Popup required",
    );
    await expect(handle({ type: "forget" }, page)).rejects.toThrow(
      "Popup required",
    );
    await expect(
      handle(
        {
          type: "join",
        },
        page,
      ),
    ).rejects.toThrow("Popup required");
    await handle({ type: "activate" }, popup);
    expect(executeScript).toHaveBeenLastCalledWith({
      target: { tabId: 1 },
      files: ["content.js"],
    });
  });
  it("does not trust foreign senders, subframes, mismatched origins or paths", async () => {
    for (const sender of [
      { ...page, id: "other" },
      { ...page, frameId: 1 },
    ])
      await expect(
        handle({ type: "list", pageUrl: "https://example.com/app" }, sender),
      ).rejects.toThrow();
    for (const pageUrl of [
      "https://evil.example/app",
      "https://example.com/other",
    ])
      await expect(handle({ type: "list", pageUrl }, page)).rejects.toThrow(
        "Page mismatch",
      );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("strips queries/fragments and uses credentials only in service-worker fetch", async () => {
    await handle(
      { type: "list", pageUrl: "https://example.com/app?token=secret#hash" },
      page,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toMatch(/secret|hash/);
    expect(url).toContain("path=%2Fapp");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({ Authorization: `Bearer ${config.token}` });
  });
  it("rejects expired tokens before API calls", async () => {
    get.mockResolvedValue({
      settings: { ...config, expiresAt: "2000-01-01T00:00:00Z" },
    });
    await expect(
      handle({ type: "list", pageUrl: "https://example.com/app" }, page),
    ).rejects.toThrow("Join the session again");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("returns joined status without disclosing credentials or displaying the join form again", async () => {
    const result = await handle({ type: "status" }, popup);
    expect(result).toEqual({
      joined: true,
      displayName: "レビュアー",
      active: false,
    });
    expect(JSON.stringify(result)).not.toContain(config.token);
    await expect(handle({ type: "status" }, page)).rejects.toThrow(
      "Popup required",
    );
  });
  it("restores only an explicitly enabled tab and origin in viewing mode", async () => {
    const { restoreReview } = await import("./background");
    await restoreReview(1);
    expect(executeScript).not.toHaveBeenCalled();
    await handle({ type: "activate", mode: "select" }, popup);
    executeScript.mockClear();
    fetchMock.mockClear();
    await restoreReview(1);
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(executeScript.mock.calls[0][0].args).toEqual([
      "https://example.com/app",
      "view",
    ]);
    getTab.mockResolvedValue({
      id: 1,
      url: "https://other.example/app",
      status: "complete",
    });
    executeScript.mockClear();
    fetchMock.mockClear();
    await restoreReview(1);
    expect(executeScript).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("stops restoration when hidden or after leaving the session", async () => {
    const { restoreReview } = await import("./background");
    await handle({ type: "activate" }, popup);
    await handle({ type: "disable" }, page);
    executeScript.mockClear();
    await restoreReview(1);
    expect(executeScript).not.toHaveBeenCalled();
    await handle({ type: "activate" }, popup);
    await handle({ type: "forget" }, popup);
    expect(sendMessage).toHaveBeenCalledWith(1, { type: "hide-review" });
    executeScript.mockClear();
    await restoreReview(1);
    expect(executeScript).not.toHaveBeenCalled();
    expect(await handle({ type: "status" }, popup)).toEqual({ joined: false });
  });
  it("does not inject when route authorization fails", async () => {
    fetchMock.mockImplementation(
      async () => new Response("{}", { status: 403 }),
    );
    await expect(handle({ type: "activate" }, popup)).rejects.toThrow();
    expect(executeScript).not.toHaveBeenCalled();
  });
  it("checks the current tab again after authorizing an earlier route", async () => {
    getTab.mockResolvedValue({
      id: 1,
      url: "https://example.com/other",
      status: "complete",
    });
    await handle({ type: "activate" }, popup);
    expect(executeScript).not.toHaveBeenCalled();
  });
  it("does not re-enable a tab if hiding wins an in-flight authorization", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((r) => {
          finish = r;
        }),
    );
    const pending = handle({ type: "activate" }, popup);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await handle({ type: "disable" }, page);
    finish(new Response(JSON.stringify({ items: [] })));
    await pending;
    expect(executeScript).not.toHaveBeenCalled();
    expect(await handle({ type: "status" }, popup)).toEqual({
      joined: true,
      displayName: "レビュアー",
      active: false,
    });
  });
  it("does not treat pre-Google cached participation as signed in", async () => {
    const legacy = { ...config } as Partial<Settings>;
    delete legacy.authProvider;
    state.settings = legacy;
    expect(await handle({ type: "status" }, popup)).toEqual({ joined: false });
    await expect(handle({ type: "activate" }, popup)).rejects.toThrow(
      "Join the session again",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
