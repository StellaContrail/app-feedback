// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Popup } from "./popup-view";
let root: Root, container: HTMLDivElement;
const send = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", { runtime: { sendMessage: send } });
  vi.spyOn(window, "close").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  send.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("shows one joined entry action that opens viewing without starting selection", async () => {
  send.mockResolvedValue({
    ok: true,
    data: { joined: true, displayName: "Reviewer A", active: false },
  });
  await act(async () => root.render(<Popup />));
  expect(
    container.querySelector('[role="status"]')?.getAttribute("aria-label"),
  ).toBe("Reviewer A として参加中");
  expect(
    container.querySelector(".extension-feedback:not([open])"),
  ).not.toBeNull();
  expect(container.querySelector("input")).toBeNull();
  expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
  const actions =
    container.querySelectorAll<HTMLButtonElement>(".actions > button");
  expect(actions).toHaveLength(1);
  const button = actions[0];
  expect(button.getAttribute("aria-label")).toBe("コメントを開く");
  await act(async () => button.click());
  expect(send).toHaveBeenCalledWith({ type: "activate", mode: "view" });
  expect(window.close).toHaveBeenCalled();
});
it("shows only Google login while signed out and returns there after logout", async () => {
  let joined = false;
  send.mockImplementation(async (message) => {
    if (message.type === "join") joined = true;
    if (message.type === "forget") joined = false;
    return {
      ok: true,
      data: joined
        ? { joined: true, displayName: "Google Name", active: false }
        : { joined: false },
    };
  });
  await act(async () => root.render(<Popup />));
  expect(container.querySelector(".extension-feedback")).toBeNull();
  expect(container.querySelector("input")).toBeNull();
  expect(container.textContent).not.toContain("参加設定");
  expect(container.textContent).not.toContain("コメントを開く");
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".join-submit")!.click(),
  );
  expect(send).toHaveBeenCalledWith({ type: "join" });
  expect(container.textContent).toContain("Google Name");
  expect(container.querySelector(".extension-feedback")).not.toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".leave")!.click(),
  );
  expect(send).toHaveBeenCalledWith({ type: "forget" });
  expect(container.textContent).toContain("Googleでログイン");
  expect(container.querySelector(".extension-feedback")).toBeNull();
  expect(container.textContent).not.toContain("コメントを開く");
});
it("keeps login available after cancellation", async () => {
  send.mockImplementation(async (message) => {
    if (message.type === "join")
      return { ok: false, error: "ログインをキャンセルしました。" };
    return { ok: true, data: { joined: false } };
  });
  await act(async () => root.render(<Popup />));
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".join-submit")!.click(),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "キャンセル",
  );
  expect(
    container.querySelector<HTMLButtonElement>(".join-submit")!.disabled,
  ).toBe(false);
});
