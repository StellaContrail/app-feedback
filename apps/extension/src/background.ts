import { feedbackSchema, pageIdentity } from "@app-feedback/shared";
import {
  apiBase,
  type Message,
  type Settings,
  type ReviewMode,
} from "./protocol";

import { joinWithGoogle, GoogleLoginError } from "./google-login";

chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
async function settings(): Promise<Settings> {
  const { settings } = await chrome.storage.session.get<{
    settings?: Settings;
  }>("settings");
  if (
    !settings ||
    settings.authProvider !== "google" ||
    !Number.isFinite(Date.parse(settings.expiresAt)) ||
    Date.parse(settings.expiresAt) <= Date.now()
  )
    throw new Error("Join the session again");
  return settings as Settings;
}
async function request(
  base: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`${apiBase(base)}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    if (body?.error?.code === "AUTH_NOT_CONFIGURED")
      throw new GoogleLoginError("setup");
    throw new Error(`API request failed (${response.status})`);
  }
  return response.json();
}
type ReviewTab = {
  origin: string;
  apiUrl: string;
  sessionId: string;
  appId: string;
};
let revision = 0;
let tabWrites: Promise<unknown> = Promise.resolve();
async function reviewTabs(): Promise<Record<string, ReviewTab>> {
  const { reviewTabs } = await chrome.storage.session.get<{
    reviewTabs?: Record<string, ReviewTab>;
  }>("reviewTabs");
  return reviewTabs ?? {};
}
function editTabs(
  edit: (tabs: Record<string, ReviewTab>) => void,
): Promise<void> {
  const update = tabWrites.then(async () => {
    const tabs = await reviewTabs();
    edit(tabs);
    await chrome.storage.session.set({ reviewTabs: tabs });
  });
  tabWrites = update.catch(() => {});
  return update;
}
async function hide(tabId: number) {
  await chrome.tabs.sendMessage(tabId, { type: "hide-review" }).catch(() => {});
}
async function stopAll() {
  revision++;
  const tabs = await reviewTabs();
  await editTabs((tabs) => {
    for (const key of Object.keys(tabs)) delete tabs[key];
  });
  await Promise.all(Object.keys(tabs).map((id) => hide(Number(id))));
}
async function inject(
  tabId: number,
  url: string,
  mode: ReviewMode,
  config: Settings,
  started: number,
) {
  const page = pageIdentity(url),
    pageUrl = `${page.origin}${page.path}`;
  // Authorize the route before showing UI, including automatic restoration.
  await request(
    config.apiUrl,
    `/v1/apps/${encodeURIComponent(config.appId)}/feedback?${new URLSearchParams({ pageUrl, path: page.path })}`,
    config.token,
  );
  const current = await chrome.tabs.get(tabId);
  if (revision !== started || !current.url || current.status === "loading")
    return;
  const actual = pageIdentity(current.url);
  if (actual.origin !== page.origin || actual.path !== page.path) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (pageUrl: string, mode: ReviewMode) => {
      const scope = globalThis as typeof globalThis & {
        __appFeedbackCommand?: { pageUrl: string; mode: ReviewMode };
      };
      scope.__appFeedbackCommand = { pageUrl, mode };
    },
    args: [pageUrl, mode],
  });
  if (revision !== started) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  if (revision !== started) {
    await hide(tabId);
    return;
  }
  await editTabs((tabs) => {
    if (revision === started)
      tabs[String(tabId)] = {
        origin: page.origin,
        apiUrl: config.apiUrl,
        sessionId: config.sessionId,
        appId: config.appId,
      };
  });
}
export async function restoreReview(tabId: number): Promise<void> {
  const started = revision,
    tracked = (await reviewTabs())[String(tabId)];
  if (!tracked) return;
  const config = await settings();
  if (
    config.sessionId !== tracked.sessionId ||
    config.appId !== tracked.appId ||
    config.apiUrl !== tracked.apiUrl
  )
    return;
  const tab = await chrome.tabs.get(tabId);
  if (
    !tab.url ||
    tab.status === "loading" ||
    pageIdentity(tab.url).origin !== tracked.origin
  )
    return;
  // activeTab may have been revoked on a cross-origin navigation. Chrome remains
  // the permission authority; never request or grant a new host permission here.
  await inject(tabId, tab.url, "view", config, started);
}
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "complete") void restoreReview(tabId).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void editTabs((tabs) => {
    delete tabs[String(tabId)];
  }).catch(() => {});
});
export async function handle(
  message: Message,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (sender.id !== chrome.runtime.id) throw new Error("Unknown sender");
  const popup = sender.url === chrome.runtime.getURL("popup.html");
  if (message.type === "status") {
    if (!popup) throw new Error("Popup required");
    let config: Settings;
    try {
      config = await settings();
    } catch {
      return { joined: false };
    }
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tracked = tab?.id ? (await reviewTabs())[String(tab.id)] : undefined;
    return {
      joined: true,
      displayName: config.displayName ?? "レビュアー",
      active:
        !!tracked &&
        tracked.appId === config.appId &&
        tracked.sessionId === config.sessionId,
    };
  }
  if (message.type === "disable") {
    const tabId = popup
      ? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id
      : sender.tab && sender.frameId === 0
        ? sender.tab.id
        : undefined;
    if (tabId === undefined) throw new Error("Top-level page required");
    revision++;
    await editTabs((tabs) => {
      delete tabs[String(tabId)];
    });
    await hide(tabId);
    return null;
  }
  if (message.type === "join") {
    if (!popup) throw new Error("Popup required");
    const started = revision;
    const base = apiBase("http://localhost:8787");
    const result = await joinWithGoogle(base, request);
    if (revision !== started) {
      await request(base, "/v1/participants/logout", result.token, {}).catch(
        () => {},
      );
      throw new GoogleLoginError("cancel");
    }
    await stopAll();
    await chrome.storage.session.set({
      settings: {
        apiUrl: base,
        sessionId: result.sessionId,
        appId: result.appId,
        token: result.token,
        expiresAt: result.expiresAt,
        displayName: result.displayName,
        authProvider: "google",
      } satisfies Settings,
    });
    return null;
  }
  if (message.type === "forget") {
    if (!popup) throw new Error("Popup required");
    let config: Settings | undefined;
    try {
      config = await settings();
    } catch {
      /* No authenticated session to revoke. */
    }
    await stopAll();
    await chrome.storage.session.clear();
    if (config)
      await request(
        config.apiUrl,
        "/v1/participants/logout",
        config.token,
        {},
      ).catch(() => {});
    return null;
  }
  const config = await settings();
  if (message.type === "activate") {
    if (!popup) throw new Error("Popup required");
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id || !tab.url) throw new Error("Open a registered HTTP(S) page");
    if (
      message.mode !== undefined &&
      message.mode !== "view" &&
      message.mode !== "select"
    )
      throw new Error("Invalid mode");
    await inject(tab.id, tab.url, message.mode ?? "view", config, revision);
    return null;
  }
  if (!sender.tab || sender.frameId !== 0 || !sender.url)
    throw new Error("Top-level page required");
  const actual = pageIdentity(sender.url);
  const raw =
    message.type === "list"
      ? message.pageUrl
      : message.type === "post"
        ? message.input.pageUrl
        : "";
  const claimed = pageIdentity(raw);
  if (actual.origin !== claimed.origin || actual.path !== claimed.path)
    throw new Error("Page mismatch");
  // URL sent to the API contains no query, fragment, credentials or page state.
  const pageUrl = `${actual.origin}${actual.path}`;
  if (message.type === "list")
    return request(
      config.apiUrl,
      `/v1/apps/${encodeURIComponent(config.appId)}/feedback?${new URLSearchParams({ pageUrl, path: actual.path })}`,
      config.token,
    );
  if (message.type === "post")
    return request(
      config.apiUrl,
      `/v1/apps/${encodeURIComponent(config.appId)}/feedback`,
      config.token,
      feedbackSchema.parse({ ...message.input, pageUrl }),
    );
  throw new Error("Unknown message");
}
chrome.runtime.onMessage.addListener((message: Message, sender, respond) => {
  void handle(message, sender)
    .then((data) => respond({ ok: true, data }))
    .catch((error: unknown) =>
      respond({
        ok: false,
        error:
          error instanceof GoogleLoginError
            ? {
                setup: "Googleログインの設定がまだ完了していません。",
                cancel: "Googleログインを中止しました。もう一度参加できます。",
                invalid:
                  "Googleログインを確認できませんでした。やり直してください。",
              }[error.kind]
            : "操作できませんでした。参加情報・対象ページ・APIの起動を確認してください。",
      }),
    );
  return true;
});
