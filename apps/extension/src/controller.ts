import {
  pageIdentity,
  type FeedbackInput,
  type FeedbackItem,
  type Target,
} from "@app-feedback/shared";
import { captureTarget, resolveTarget, selectable } from "./selector";
import type { ReviewMode } from "./protocol";
import { panelStyles } from "./ui-styles";
import { feedbackExport } from "./feedback-export";
import { createIcon } from "./ui-icons";
export interface Transport {
  list(pageUrl: string): Promise<{ items: FeedbackItem[] }>;
  post(input: FeedbackInput): Promise<unknown>;
  stop?(): Promise<unknown>;
}
const instances = new WeakMap<Document, () => void>();
const categoryNames: Record<string, string> = {
  bug: "不具合",
  suggestion: "提案",
  praise: "よかった点",
};
export function mount(
  transport: Transport,
  options: { mode?: ReviewMode } = {},
): () => void {
  instances.get(document)?.();
  const host = document.createElement("app-feedback-ui");
  host.style.cssText =
    "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = panelStyles;
  root.append(style);
  const surface = document.createElement("div");
  surface.className = "af-surface";
  root.append(surface);
  const panel = document.createElement("section");
  panel.setAttribute("aria-label", "App feedback");
  const title = document.createElement("strong");
  title.textContent = "コメント";
  title.className = "panel-title";
  title.prepend(createIcon("comment"));
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.className = "panel-status";
  const list = document.createElement("ol");
  const form = document.createElement("form");
  form.hidden = true;
  const label = document.createElement("label");
  label.textContent = "コメント";

  const comment = document.createElement("textarea");
  comment.placeholder = "気づいたことを書いてください";
  comment.maxLength = 2000;
  comment.required = true;
  label.append(comment);
  const category = document.createElement("select");
  category.setAttribute("aria-label", "種類");
  for (const value of ["bug", "suggestion", "praise"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = categoryNames[value];
    category.append(option);
  }
  category.value = "suggestion";
  const extra = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "種類を選ぶ（任意）";
  extra.append(summary, category);
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "キャンセル";
  cancel.onclick = () => viewMode();
  const submit = document.createElement("button");
  submit.textContent = "投稿する";
  submit.type = "submit";
  const formActions = document.createElement("div");
  formActions.className = "form-actions";
  formActions.append(submit, cancel);
  form.append(label, extra, formActions);
  const highlight = document.createElement("div");
  highlight.className = "highlight";
  highlight.hidden = true;
  const pins = document.createElement("div");
  let selecting = options.mode === "select",
    disposed = false,
    target: Target | null = null,
    items: FeedbackItem[] = [],
    generation = 0;
  let activeFeedbackId: string | null = null;
  const entries = new Map<
    string,
    {
      row: HTMLLIElement;
      action: HTMLButtonElement;
      number: HTMLSpanElement;
      category: HTMLSpanElement;
      body: HTMLSpanElement;
      note: HTMLSpanElement;
      pin: HTMLButtonElement;
    }
  >();
  const preview = document.createElement("aside");
  preview.className = "feedback-preview";
  preview.setAttribute("aria-label", "選択したコメント");
  preview.hidden = true;
  const previewTitle = document.createElement("strong");
  const previewBody = document.createElement("p");
  previewBody.className = "comment-body";
  const previewClose = document.createElement("button");
  previewClose.type = "button";
  previewClose.className = "panel-close";
  previewClose.textContent = "×";
  previewClose.setAttribute("aria-label", "コメントの詳細を閉じる");
  previewClose.onclick = () => {
    activeFeedbackId = null;
    position();
  };
  const previewHeader = document.createElement("header");
  previewHeader.className = "panel-header";
  previewHeader.append(previewTitle, previewClose);
  preview.append(previewHeader, previewBody);
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "copy-action";
  copy.textContent = "一覧をコピー";
  copy.disabled = true;
  copy.title = "このページのコメントと対象情報をコピー";
  copy.onclick = async () => {
    if (syncPage() !== "ready" || !items.length || copy.disabled) return;
    const page = currentPage;
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(feedbackExport(page, items));
      if (syncPage() === "ready" && currentPage === page)
        status.textContent =
          "一覧をコピーしました。AIやエディターに貼り付けられます。";
    } catch {
      if (syncPage() === "ready" && currentPage === page)
        status.textContent =
          "コピーできませんでした。ページにフォーカスして再試行してください。HTTPS（またはlocalhost）のページで利用できます。";
    } finally {
      if (syncPage() === "ready") copy.disabled = !items.length;
    }
  };
  let currentPage = pageUrl();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading = false;
  const close = document.createElement("button");
  close.textContent = "×";
  close.className = "panel-close";
  close.setAttribute("aria-label", "このタブのコメント表示をやめる");
  close.type = "button";
  close.onclick = () => {
    cleanup();
    void transport.stop?.().catch(() => {});
  };
  const select = document.createElement("button");
  select.type = "button";
  select.className = "write-action";
  select.onclick = () => {
    if (syncPage() === "closed") return;
    if (selecting) {
      viewMode();
      return;
    }
    target = null;
    activeFeedbackId = null;
    highlight.hidden = true;
    preview.hidden = true;
    selecting = true;
    form.hidden = true;
    showStatus();
  };
  const header = document.createElement("header");
  header.className = "panel-header";
  header.append(title, close);
  const tools = document.createElement("div");
  tools.className = "list-tools";
  tools.append(copy);
  panel.append(header, status, select, form, tools, list);
  surface.append(highlight, pins, panel, preview);
  document.documentElement.append(host);
  showStatus();
  function showStatus() {
    copy.disabled = !items.length;
    for (const entry of entries.values()) {
      entry.action.disabled = !form.hidden;
      entry.pin.disabled = !form.hidden;
    }
    panel.dataset.mode = selecting
      ? "select"
      : !form.hidden
        ? "compose"
        : items.length
          ? "list"
          : "empty";
    select.hidden = !form.hidden;
    select.textContent = selecting ? "選択をやめる" : "＋ コメントを書く";
    status.textContent = selecting
      ? "コメントする場所をクリックしてください。Escで選択をやめます。"
      : !form.hidden
        ? "選んだ場所へのコメント"
        : items.length
          ? `コメント ${items.length}件`
          : "まだコメントはありません。";
  }
  function viewMode() {
    selecting = false;
    target = null;
    form.hidden = true;
    comment.value = "";
    activeFeedbackId = null;
    highlight.hidden = true;
    preview.hidden = true;
    showStatus();
  }
  function pageUrl() {
    const p = pageIdentity(location.href);
    return `${p.origin}${p.path}`;
  }
  function inUI(e: Event) {
    return e.composedPath().includes(host);
  }
  function reveal(id: string, scroll: boolean) {
    if (syncPage() !== "ready" || !form.hidden) return;
    const item = items.find((item) => item.id === id);
    if (!item) return;
    if (selecting) viewMode();
    activeFeedbackId = id;
    const el = resolveTarget(item.target);
    if (scroll && el)
      el.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
    position();
    const entry = entries.get(id);
    if (!scroll && entry) {
      entry.row.scrollIntoView({ block: "nearest" });
      entry.action.focus({ preventScroll: true });
    }
    status.textContent = el
      ? "選んだコメントの対象を表示中"
      : "対象が見つかりません。コメントは一覧で確認できます。";
  }
  function position() {
    if (!items.some((item) => item.id === activeFeedbackId))
      activeFeedbackId = null;
    preview.hidden = true;
    previewBody.textContent = "";
    previewTitle.textContent = "";
    if (!selecting) highlight.hidden = true;
    const ids = new Set(items.map((item) => item.id));
    for (const [id, entry] of entries) {
      if (ids.has(id)) continue;
      entry.row.remove();
      entry.pin.remove();
      entries.delete(id);
    }
    items.forEach((item, index) => {
      let entry = entries.get(item.id);
      if (!entry) {
        const row = document.createElement("li");
        const action = document.createElement("button");
        action.type = "button";
        action.className = "comment-action";
        action.onclick = () => reveal(item.id, true);
        const meta = document.createElement("span");
        meta.className = "comment-meta";
        const number = document.createElement("span");
        number.className = "comment-number";
        const category = document.createElement("span");
        category.className = "comment-category";
        const body = document.createElement("span");
        body.className = "comment-body";
        const note = document.createElement("span");
        note.className = "unavailable";
        meta.append(number, category);
        action.append(meta, body, note);
        row.append(action);
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "pin";
        pin.onclick = () => reveal(item.id, false);
        entry = { row, action, number, category, body, note, pin };
        entries.set(item.id, entry);
        list.append(row);
        pins.append(pin);
      }
      const { row, action, number, category, body, note, pin } = entry;
      if (list.children[index] !== row)
        list.insertBefore(row, list.children[index] ?? null);
      row.dataset.category = item.category;
      const active = item.id === activeFeedbackId;
      row.classList.toggle("is-active", active);
      action.setAttribute("aria-pressed", String(active));
      action.disabled = pin.disabled = !form.hidden;
      number.textContent = "#" + (index + 1);
      category.textContent = categoryNames[item.category];
      body.textContent = item.comment;
      const el = resolveTarget(item.target),
        rect = el?.getBoundingClientRect();
      const available = !!(
        el &&
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        getComputedStyle(el).visibility !== "hidden"
      );
      const visible =
        available &&
        rect!.bottom > 0 &&
        rect!.right > 0 &&
        rect!.top < innerHeight &&
        rect!.left < innerWidth;
      note.hidden = available;
      note.textContent = "対象が見つかりません";
      pin.hidden = !visible;
      pin.textContent = String(index + 1);
      pin.setAttribute("aria-label", "Feedback " + (index + 1));
      pin.setAttribute("aria-pressed", String(active));
      if (visible) {
        pin.style.left =
          Math.max(0, Math.min(innerWidth - 30, rect!.left)) + "px";
        pin.style.top =
          Math.max(0, Math.min(innerHeight - 30, rect!.top)) + "px";
      }
      if (active && available && !selecting && form.hidden) {
        highlight.hidden = !visible;
        highlight.style.left = rect!.left + "px";
        highlight.style.top = rect!.top + "px";
        highlight.style.width = rect!.width + "px";
        highlight.style.height = rect!.height + "px";
        if (visible) {
          preview.hidden = false;
          previewTitle.textContent =
            "#" + (index + 1) + " · " + categoryNames[item.category];
          previewBody.textContent = item.comment;
          preview.style.left =
            Math.max(8, Math.min(innerWidth - 296, rect!.left)) + "px";
          preview.style.top =
            Math.max(8, Math.min(innerHeight - 240, rect!.bottom + 8)) + "px";
        }
      }
    });
  }
  async function load() {
    if (syncPage() !== "ready") return;
    const version = ++generation,
      page = currentPage;
    loading = true;
    try {
      const result = await transport.list(page);
      if (
        syncPage() !== "ready" ||
        version !== generation ||
        page !== currentPage
      )
        return;
      items = result.items;
      position();
      showStatus();
    } catch {
      if (syncPage() === "ready" && version === generation) {
        items = [];
        position();
        status.textContent =
          "読み込めませんでした。参加情報と対象ページを確認してください。";
      }
    } finally {
      if (version === generation) loading = false;
    }
  }
  // Check the live URL at event/async boundaries, not only on the route poll.
  // A removed host must release selection listeners even before observer delivery.
  function syncPage(): "ready" | "changed" | "closed" {
    if (disposed) return "closed";
    if (host.getRootNode() !== document) {
      cleanup();
      return "closed";
    }
    let next: string;
    try {
      next = pageUrl();
    } catch {
      cleanup();
      return "closed";
    }
    if (next !== currentPage) {
      currentPage = next;
      activeFeedbackId = null;
      generation++;
      target = null;
      selecting = false;
      form.hidden = true;
      comment.value = "";
      highlight.hidden = true;
      items = [];
      showStatus();
      position();
      void load();
      return "changed";
    }
    return "ready";
  }
  function update() {
    if (syncPage() === "ready") position();
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, 100);
  }
  function hover(e: MouseEvent) {
    if (syncPage() === "closed" || !selecting || inUI(e)) return;
    const el = e.target;
    highlight.hidden = true;
    if (!(el instanceof Element) || !selectable(el)) return;
    const r = el.getBoundingClientRect();
    highlight.hidden = false;
    highlight.style.left = `${r.left}px`;
    highlight.style.top = `${r.top}px`;
    highlight.style.width = `${r.width}px`;
    highlight.style.height = `${r.height}px`;
  }
  function click(e: MouseEvent) {
    if (syncPage() === "closed" || !selecting || inUI(e)) return;
    // Cancel even an ineligible target: selection must never follow links or submit.
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = e.target;
    target = el instanceof Element ? captureTarget(el) : null;
    if (!target) {
      status.textContent =
        "この要素は選択できません。別の場所を選んでください。";
      return;
    }
    selecting = false;
    highlight.hidden = true;
    form.hidden = false;
    comment.focus();
    showStatus();
  }
  function blockPointer(e: Event) {
    if (syncPage() === "closed") return;
    if (selecting && !inUI(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  function key(e: KeyboardEvent) {
    if (syncPage() === "closed") return;
    if (e.key === "Escape" && (selecting || !form.hidden)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      viewMode();
    } else if (e.key === "Escape" && activeFeedbackId) {
      e.preventDefault();
      e.stopImmediatePropagation();
      activeFeedbackId = null;
      position();
    } else if (selecting && !inUI(e) && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (
      syncPage() !== "ready" ||
      !target ||
      !comment.value.trim() ||
      submit.disabled
    )
      return;
    const page = currentPage,
      selected = target;
    submit.disabled = true;
    try {
      await transport.post({
        pageUrl: page,
        target,
        category: category.value as FeedbackInput["category"],
        comment: comment.value.trim(),
      });
      if (syncPage() !== "ready" || selected !== target || page !== currentPage)
        return;
      comment.value = "";
      form.hidden = true;
      target = null;
      viewMode();
      await load();
    } catch {
      if (syncPage() === "ready" && page === currentPage)
        status.textContent =
          "投稿できませんでした。参加情報と対象ページを確認してください。";
    } finally {
      submit.disabled = false;
    }
  };
  const observer = new MutationObserver((records) => {
    if (host.getRootNode() !== document) {
      cleanup();
      return;
    }
    if (records.some((r) => !host.contains(r.target) && r.target !== host))
      schedule();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  document.addEventListener("mousemove", hover, true);
  document.addEventListener("click", click, true);
  for (const type of [
    "pointerdown",
    "mousedown",
    "mouseup",
    "pointerup",
    "auxclick",
    "dblclick",
  ])
    document.addEventListener(type, blockPointer, true);
  document.addEventListener("keydown", key, true);
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);
  window.addEventListener("pagehide", cleanup);
  // Isolated world cannot reliably wrap the page's history methods. Poll only the URL,
  // and refresh membership-protected feedback periodically while mounted.
  const routePoll = setInterval(syncPage, 250);
  const refresh = setInterval(() => {
    if (!loading) void load();
  }, 15000);
  function cleanup() {
    if (disposed) return;
    disposed = true;
    generation++;
    observer.disconnect();
    clearTimeout(timer);
    clearInterval(routePoll);
    clearInterval(refresh);
    document.removeEventListener("mousemove", hover, true);
    document.removeEventListener("click", click, true);
    for (const type of [
      "pointerdown",
      "mousedown",
      "mouseup",
      "pointerup",
      "auxclick",
      "dblclick",
    ])
      document.removeEventListener(type, blockPointer, true);
    document.removeEventListener("keydown", key, true);
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("popstate", schedule);
    window.removeEventListener("hashchange", schedule);
    window.removeEventListener("pagehide", cleanup);
    host.remove();
    if (instances.get(document) === cleanup) instances.delete(document);
  }
  instances.set(document, cleanup);
  void load();
  return cleanup;
}
