// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExtensionFeedback, extensionIssueUrl } from "./extension-feedback";
let root: Root, container: HTMLDivElement;
const create = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", {
    runtime: { getManifest: () => ({ version: "0.1.2" }) },
    tabs: { create },
  });
  create.mockReset().mockResolvedValue({ id: 1 });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function draft(text: string) {
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("opens the fixed repository's Issue editor with only user text and version", () => {
  const text = "種類が選びづらい\n&labels=admin#test <script>literal</script>";
  const url = new URL(extensionIssueUrl(text, "0.1.2"));
  expect(url.origin + url.pathname).toBe(
    "https://github.com/StellaContrail/app-feedback/issues/new",
  );
  expect(Array.from(url.searchParams.keys()).sort()).toEqual(["body", "title"]);
  expect(url.searchParams.get("title")).toBe("[拡張機能] 種類が選びづらい");
  expect(url.searchParams.get("body")).toBe(
    `## フィードバック\n\n${text}\n\n---\nApp Feedback バージョン: 0.1.2`,
  );
  expect(url.hash).toBe("");
  expect(extensionIssueUrl("あ".repeat(500), "0.1.2").length).toBeLessThan(
    8192,
  );
  for (const text of ["", "  ", "x".repeat(501)])
    expect(() => extensionIssueUrl(text, "0.1.2")).toThrow();
});
it("explains the final GitHub action before opening a tab", async () => {
  await act(async () => root.render(<ExtensionFeedback />));
  expect(container.querySelector("details")!.open).toBe(false);
  expect(container.querySelector("button")!.disabled).toBe(true);
  expect(container.textContent).toContain("GitHubアカウントが必要");
  expect(container.textContent).toContain("投稿内容は公開");
  await act(async () => container.querySelector("summary")!.click());
  expect(container.querySelector("details")!.open).toBe(true);
  await draft("この拡張機能をもっと使いたい");
  await act(async () => container.querySelector("button")!.click());
  expect(create).toHaveBeenCalledTimes(1);
  expect(
    new URL(create.mock.calls[0][0].url).searchParams.get("body"),
  ).toContain("この拡張機能をもっと使いたい");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("keeps the draft for retry when opening GitHub fails", async () => {
  create.mockRejectedValueOnce(new Error("Tab creation failed"));
  await act(async () => root.render(<ExtensionFeedback />));
  await draft("投稿できない");
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "GitHubを開けませんでした",
  );
  expect(container.querySelector("textarea")!.value).toBe("投稿できない");
  await act(async () => container.querySelector("button")!.click());
  expect(create).toHaveBeenCalledTimes(2);
});
