import { targetSchema, type Target } from "@app-feedback/shared";

const forbidden =
  'input,textarea,select,option,script,style,iframe,[contenteditable]:not([contenteditable="false"]),[data-private],[hidden],[aria-hidden="true"]';
export function selectable(el: Element): boolean {
  return (
    el instanceof HTMLElement &&
    !el.closest(forbidden) &&
    el.getRootNode() === document &&
    el !== document.documentElement &&
    el !== document.body
  );
}
// Positional selectors deliberately never copy IDs, attributes or field values.
export function buildSelector(el: Element): string | null {
  if (!selectable(el)) return null;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) return null;
    const siblings: Element[] = Array.from(
      current.parentElement?.children ?? [],
    ).filter((s) => s.tagName === current?.tagName);
    parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
    current = current.parentElement;
  }
  const selector = `html > ${parts.join(" > ")}`;
  return selector.length <= 512 ? selector : null;
}
export function safeSnippet(el: Element): string {
  // Read only visible direct text; never descendant form controls, attributes or HTML.
  if (
    !selectable(el) ||
    ![
      "BUTTON",
      "A",
      "P",
      "SPAN",
      "LABEL",
      "H1",
      "H2",
      "H3",
      "H4",
      "LI",
    ].includes(el.tagName)
  )
    return "";
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
export function captureTarget(el: Element): Target | null {
  const selector = buildSelector(el);
  if (!selector) return null;
  const rect = el.getBoundingClientRect();
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return {
    selector,
    tagName: el.tagName,
    textSnippet: safeSnippet(el),
    rect: {
      x: clamp(rect.x / innerWidth),
      y: clamp(rect.y / innerHeight),
      width: clamp(rect.width / innerWidth),
      height: clamp(rect.height / innerHeight),
    },
  };
}
export function resolveTarget(target: Target): Element | null {
  if (!targetSchema.safeParse(target).success) return null;
  try {
    const matches = document.querySelectorAll(target.selector);
    const el = matches.length === 1 ? matches[0] : null;
    return el &&
      selectable(el) &&
      el.tagName === target.tagName &&
      (!target.textSnippet || safeSnippet(el) === target.textSnippet)
      ? el
      : null;
  } catch {
    return null;
  }
}
