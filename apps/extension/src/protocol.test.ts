import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("pins server requests to the HTTPS origin selected at build time", async () => {
  vi.stubGlobal("__API_ORIGIN__", "https://feedback.example.com");
  vi.resetModules();
  const { apiBase } = await import("./protocol");
  expect(apiBase("https://feedback.example.com/")).toBe(
    "https://feedback.example.com",
  );
  for (const origin of [
    "http://feedback.example.com",
    "https://other.example.com",
    "http://localhost:8787",
    "https://feedback.example.com/path",
    "https://feedback.example.com?token=x",
    "https://user:pass@feedback.example.com",
  ])
    expect(() => apiBase(origin)).toThrow();
});
