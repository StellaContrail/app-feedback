// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSelector,
  captureTarget,
  resolveTarget,
  safeSnippet,
} from "./selector";
beforeEach(() => {
  document.body.replaceChildren();
});
describe("private selector capture and defensive resolution", () => {
  it("round trips without copying IDs, attributes or descendant form values", () => {
    document.body.innerHTML =
      '<div id="secret-token"><button data-token="private">Save<input value="password"><span>descendant</span></button></div>';
    const el = document.querySelector("button")!;
    const target = captureTarget(el)!;
    expect(target.selector).toBe(
      "html > body:nth-of-type(1) > div:nth-of-type(1) > button:nth-of-type(1)",
    );
    expect(target.textSnippet).toBe("Save");
    expect(JSON.stringify(target)).not.toMatch(
      /secret-token|private|password|descendant/,
    );
    expect(resolveTarget(target)).toBe(el);
  });
  it("excludes sensitive fields and editable/private ancestors", () => {
    document.body.innerHTML =
      '<input type="password" value="secret"><textarea>secret</textarea><div contenteditable><span>secret</span></div><div data-private><button>private</button></div>';
    for (const el of document.body.querySelectorAll("*")) {
      expect(buildSelector(el)).toBeNull();
      expect(safeSnippet(el)).toBe("");
    }
  });
  it("fails closed on invalid, ambiguous, missing and changed targets", () => {
    document.body.innerHTML = "<button>Save</button><button>Cancel</button>";
    const target = captureTarget(document.querySelector("button")!)!;
    for (const selector of ["[", "button", "script", "x".repeat(513)])
      expect(resolveTarget({ ...target, selector })).toBeNull();
    document.querySelector("button")!.textContent = "Delete";
    expect(resolveTarget(target)).toBeNull();
    document.querySelector("button")!.remove();
    expect(resolveTarget(target)).toBeNull();
  });
  it("clamps viewport ratios and bounds snippet lengths", () => {
    const el = document.createElement("button");
    el.textContent = "x".repeat(500);
    document.body.append(el);
    const target = captureTarget(el)!;
    expect(target.textSnippet).toHaveLength(120);
    for (const n of Object.values(target.rect)) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });
});
