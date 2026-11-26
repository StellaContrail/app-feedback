import type { FeedbackInput } from "@app-feedback/shared";
export interface Settings {
  authProvider: "google";
  apiUrl: string;
  sessionId: string;
  appId: string;
  token: string;
  expiresAt: string;
  displayName?: string;
}
export type ReviewMode = "view" | "select";
export type SessionStatus =
  { joined: false } | { joined: true; displayName: string; active: boolean };
export type Message =
  | { type: "join" }
  | { type: "status" }
  | { type: "activate"; mode?: ReviewMode }
  | { type: "disable" }
  | { type: "list"; pageUrl: string }
  | { type: "post"; input: FeedbackInput }
  | { type: "forget" };
export type Reply<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string };
export function apiBase(raw: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Use a local API origin, e.g. http://localhost:8787");
  return url.origin;
}
export async function send<T>(message: Message): Promise<T> {
  const reply: Reply<T> = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error ?? "Extension unavailable");
  return reply.data;
}
