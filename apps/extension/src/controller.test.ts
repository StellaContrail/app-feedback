// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Transport } from "./controller";
import { captureTarget } from "./selector";
import type { FeedbackItem } from "@app-feedback/shared";
let cleanup: (() => void) | undefined;
let root: ShadowRoot;
const writeText = vi.fn();
const scrollIntoView = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  scrollIntoView.mockReset();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
  window.history.replaceState({}, "", "/app");
  document.body.innerHTML =
    '<a href="/navigate">Save</a><form><button type="submit">Submit</button></form>';
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    root = attach.call(this, init);
    return root;
  });
});
afterEach(() => {
  cleanup?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.querySelectorAll("app-feedback-ui").forEach((el) => el.remove());
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function transport(items: FeedbackItem[] = []): Transport {
  return {
    list: vi.fn().mockResolvedValue({ items }),
    post: vi.fn().mockResolvedValue({}),
  };
}
describe("selection lifecycle", () => {
  it("prevents navigation/submission, highlights, posts only safe metadata and uses shadow UI", async () => {
    const t = transport();
    cleanup = mount(t, { mode: "select" });
    await flush();
    expect(document.querySelector("app-feedback-ui")?.shadowRoot).toBeNull();
    const button = document.querySelector("button")!;
    button.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(root.querySelector<HTMLElement>(".highlight")!.hidden).toBe(false);
    const native = vi.fn();
    button.addEventListener("click", native);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(button.dispatchEvent(click)).toBe(false);
    expect(native).not.toHaveBeenCalled();
    const field = root.querySelector("textarea")!;
    field.value = "Useful feedback";
    root
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(t.post).toHaveBeenCalledWith(
      expect.objectContaining({
        comment: "Useful feedback",
        pageUrl: "http://localhost:3000/app",
        target: expect.objectContaining({
          tagName: "BUTTON",
          textSnippet: "Submit",
        }),
      }),
    );
  });
  it("keeps one UI, cancels with Escape and cleans up on explicit close", async () => {
    const t = transport();
    const first = mount(t, { mode: "select" });
    cleanup = mount(t, { mode: "select" });
    await flush();
    expect(document.querySelectorAll("app-feedback-ui")).toHaveLength(1);
    first();
    expect(document.querySelectorAll("app-feedback-ui")).toHaveLength(1);
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.querySelector("app-feedback-ui")).not.toBeNull();
    root
      .querySelector<HTMLButtonElement>(
        'button[aria-label="このタブのコメント表示をやめる"]',
      )!
      .click();
    expect(document.querySelector("app-feedback-ui")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("a")!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
  it("renders hostile feedback as text and stale targets in the list", async () => {
    const item: FeedbackItem = {
      id: "1",
      target: captureTarget(document.querySelector("a")!)!,
      category: "bug",
      comment: "<img src=x onerror=alert(1)>",
      createdAt: new Date().toISOString(),
    };
    cleanup = mount(transport([item]));
    await flush();
    expect(root.querySelector("li")!.textContent).toContain(item.comment);
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("li")!.textContent).toContain(
      "対象が見つかりません",
    );
  });
  it("clears targets after SPA route changes and ignores stale in-flight reads", async () => {
    let resolve!: (value: { items: FeedbackItem[] }) => void;
    const t: Transport = {
      list: vi
        .fn()
        .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
        .mockResolvedValue({ items: [] }),
      post: vi.fn(),
    };
    cleanup = mount(t, { mode: "select" });
    document
      .querySelector("a")!
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    expect(root.querySelector<HTMLFormElement>("form")!.hidden).toBe(false);
    window.history.pushState({}, "", "/other?token=private#ignored");
    await vi.advanceTimersByTimeAsync(300);
    expect(root.querySelector<HTMLFormElement>("form")!.hidden).toBe(true);
    expect(t.list).toHaveBeenLastCalledWith("http://localhost:3000/other");
    resolve({
      items: [
        {
          id: "old",
          target: {
            selector: "a",
            tagName: "A",
            textSnippet: "Save",
            rect: { x: 0, y: 0, width: 0, height: 0 },
          },
          category: "bug",
          comment: "old route",
          createdAt: "",
        },
      ],
    });
    await flush();
    expect(root.textContent).not.toContain("old route");
  });
  it("debounces DOM changes and cleans up on full navigation", async () => {
    const t = transport();
    cleanup = mount(t, { mode: "select" });
    await flush();
    document.querySelector("a")!.remove();
    await vi.advanceTimersByTimeAsync(200);
    expect(t.list).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(document.querySelector("app-feedback-ui")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clears a successful draft even if a periodic read completed during posting", async () => {
    let complete!: () => void;
    const t = transport();
    t.post = vi.fn().mockImplementation(
      () =>
        new Promise<void>((r) => {
          complete = r;
        }),
    );
    cleanup = mount(t, { mode: "select" });
    await flush();
    document
      .querySelector("a")!
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    root.querySelector("textarea")!.value = "Draft";
    root
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.advanceTimersByTimeAsync(15000);
    complete();
    await flush();
    expect(root.querySelector("textarea")!.value).toBe("");
    expect(root.querySelector<HTMLFormElement>("form")!.hidden).toBe(true);
  });
  it("cleans up when SPA navigation reaches an unsupported ambiguous route", async () => {
    cleanup = mount(transport(), { mode: "select" });
    await flush();
    window.history.pushState({}, "", "/app%2fprivate");
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector("app-feedback-ui")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases page clicks immediately if the host page removes the UI", async () => {
    const t = transport();
    cleanup = mount(t, { mode: "select" });
    await flush();
    document.querySelector("app-feedback-ui")!.remove();
    const native = vi.fn();
    const button = document.querySelector("button")!;
    button.type = "button";
    button.addEventListener("click", native);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(native).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(16000);
    expect(t.list).toHaveBeenCalledTimes(1);
  });
  it("cleans up a removed UI without waiting for another user interaction", async () => {
    cleanup = mount(transport(), { mode: "select" });
    await flush();
    document.querySelector("app-feedback-ui")!.remove();
    await flush();
    await vi.advanceTimersByTimeAsync(300);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("discards an old read immediately after pushState, before the route poll", async () => {
    let resolve!: (value: { items: FeedbackItem[] }) => void;
    const item: FeedbackItem = {
      id: "old",
      target: captureTarget(document.querySelector("a")!)!,
      category: "bug",
      comment: "Old route only",
      createdAt: "",
    };
    const t = transport();
    t.list = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue({ items: [] });
    cleanup = mount(t, { mode: "select" });
    window.history.pushState({}, "", "/other");
    resolve({ items: [item] });
    await flush();
    expect(root.textContent).not.toContain("Old route only");
    expect(t.list).toHaveBeenLastCalledWith("http://localhost:3000/other");
  });
  it("clears an old draft rather than posting it immediately after pushState", async () => {
    const t = transport();
    cleanup = mount(t, { mode: "select" });
    await flush();
    document
      .querySelector("a")!
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    root.querySelector("textarea")!.value = "Old draft";
    window.history.pushState({}, "", "/other");
    root
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(t.post).not.toHaveBeenCalled();
    expect(root.querySelector("textarea")!.value).toBe("");
    expect(root.querySelector<HTMLFormElement>("form")!.hidden).toBe(true);
    expect(t.list).toHaveBeenLastCalledWith("http://localhost:3000/other");
  });
  it("does not reload the old route when a post completes before the route poll", async () => {
    let complete!: () => void;
    const t = transport();
    t.post = vi.fn().mockImplementation(
      () =>
        new Promise<void>((r) => {
          complete = r;
        }),
    );
    cleanup = mount(t, { mode: "select" });
    await flush();
    document
      .querySelector("a")!
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    root.querySelector("textarea")!.value = "In flight";
    root
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    window.history.pushState({}, "", "/other");
    complete();
    await flush();
    expect(t.list).toHaveBeenLastCalledWith("http://localhost:3000/other");
    expect(root.querySelector("textarea")!.value).toBe("");
  });
  it("opens in viewing mode so ordinary page navigation is not intercepted", async () => {
    cleanup = mount(transport());
    await flush();
    const button = document.querySelector("button")!;
    button.type = "button";
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(root.querySelector<HTMLFormElement>("form")!.hidden).toBe(true);
    expect(root.textContent).toContain("コメントを書く");
  });
  it("Escape cancels selection while keeping comments visible", async () => {
    cleanup = mount(transport(), { mode: "select" });
    await flush();
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.querySelector("app-feedback-ui")).not.toBeNull();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const button = document.querySelector("button")!;
    button.type = "button";
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

function savedFeedback(): FeedbackItem {
  return {
    id: "saved",
    target: captureTarget(document.querySelector("a")!)!,
    category: "bug",
    comment: "Saved comment <img src=x>",
    createdAt: "2026-11-26T00:00:00.000Z",
  };
}
function visibleTarget(top = 40) {
  const el = document.querySelector("a")!;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 20,
    right: 120,
    top,
    bottom: top + 30,
    width: 100,
    height: 30,
    x: 20,
    y: top,
    toJSON: () => ({}),
  });
  return el;
}
it("list actions scroll offscreen targets into view, highlight and never activate the target", async () => {
  const el = visibleTarget(2000),
    item = savedFeedback(),
    native = vi.fn();
  el.addEventListener("click", native);
  cleanup = mount(transport([item]));
  await flush();
  expect(root.querySelector<HTMLElement>(".unavailable")!.hidden).toBe(true);
  expect(root.querySelector<HTMLButtonElement>(".pin")!.hidden).toBe(true);
  scrollIntoView.mockImplementation(() => {
    visibleTarget(60);
  });
  const action = root.querySelector<HTMLButtonElement>(".comment-action")!;
  action.click();
  expect(scrollIntoView).toHaveBeenCalledWith({
    block: "center",
    inline: "center",
    behavior: "instant",
  });
  expect(native).not.toHaveBeenCalled();
  expect(root.querySelector<HTMLElement>(".highlight")!.hidden).toBe(false);
  expect(root.querySelector<HTMLElement>(".highlight")!.style.top).toBe("60px");
  expect(action.getAttribute("aria-pressed")).toBe("true");
  action.focus();
  window.dispatchEvent(new Event("scroll"));
  await vi.advanceTimersByTimeAsync(150);
  expect(root.querySelector(".comment-action")).toBe(action);
  expect(root.activeElement).toBe(action);
});
it("pins open a text-only detail card and keep highlighting aligned with layout changes", async () => {
  visibleTarget();
  const item = savedFeedback();
  cleanup = mount(transport([item]));
  await flush();
  root.querySelector<HTMLButtonElement>(".pin")!.click();
  const preview = root.querySelector<HTMLElement>(".feedback-preview")!;
  expect(preview.hidden).toBe(false);
  expect(preview.textContent).toContain(item.comment);
  expect(preview.querySelector("img")).toBeNull();
  expect(root.querySelector("li")!.classList.contains("is-active")).toBe(true);
  visibleTarget(80);
  window.dispatchEvent(new Event("resize"));
  await vi.advanceTimersByTimeAsync(150);
  expect(root.querySelector<HTMLElement>(".highlight")!.style.top).toBe("80px");
  root
    .querySelector<HTMLButtonElement>(
      'button[aria-label="コメントの詳細を閉じる"]',
    )!
    .click();
  expect(preview.hidden).toBe(true);
  expect(root.querySelector<HTMLElement>(".highlight")!.hidden).toBe(true);
});
it("stale or old-route list actions never jump to an unrelated target", async () => {
  visibleTarget();
  const item = savedFeedback();
  cleanup = mount(transport([item]));
  await flush();
  document.querySelector("a")!.textContent = "Changed target";
  root.querySelector<HTMLButtonElement>(".comment-action")!.click();
  expect(scrollIntoView).not.toHaveBeenCalled();
  expect(root.querySelector<HTMLElement>(".feedback-preview")!.hidden).toBe(
    true,
  );
  expect(root.querySelector('[role="status"]')!.textContent).toContain(
    "対象が見つかりません",
  );
  window.history.pushState({}, "", "/other");
  root.querySelector<HTMLButtonElement>(".comment-action")!.click();
  expect(scrollIntoView).not.toHaveBeenCalled();
  expect(root.querySelector("li")).toBeNull();
});
it("copies feedback with one click, reports denial and does not copy an old route", async () => {
  const item = savedFeedback();
  cleanup = mount(transport([item]));
  await flush();
  const button = root.querySelector<HTMLButtonElement>(".copy-action")!;
  button.click();
  await flush();
  expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({
    pageUrl: "http://localhost:3000/app",
    feedback: [{ comment: item.comment }],
  });
  expect(root.querySelector('[role="status"]')!.textContent).toContain(
    "コピーしました",
  );
  writeText.mockRejectedValueOnce(new Error("Denied"));
  button.click();
  await flush();
  expect(root.querySelector('[role="status"]')!.textContent).toContain(
    "コピーできませんでした",
  );
  expect(button.disabled).toBe(false);
  window.history.pushState({}, "", "/other");
  button.click();
  expect(writeText).toHaveBeenCalledTimes(2);
});
