import { describe, expect, it } from "vitest";
import {
  pageIdentity,
  normalizePath,
  withinBase,
  feedbackSchema,
} from "./index";
describe("route boundaries", () => {
  it("removes query, fragment and trailing slash", () => {
    expect(pageIdentity("https://example.com/a/?secret=x#token")).toEqual({
      origin: "https://example.com",
      path: "/a",
    });
  });
  it("rejects credentials, schemes and ambiguous separators", () => {
    for (const s of ["file:///tmp", "https://u:p@a.com", "https://a.com/a%2fb"])
      expect(() => pageIdentity(s)).toThrow();
    for (const s of ["//evil", "/a?b", "/a\\b"])
      expect(() => normalizePath(s)).toThrow();
  });
  it("matches path segments", () => {
    expect(withinBase("/apps/a", "/apps")).toBe(true);
    expect(withinBase("/appstore", "/apps")).toBe(false);
  });
  it("rejects secret-bearing metadata and oversized comments", () => {
    const input = {
      pageUrl: "https://example.com",
      target: {
        selector: "input",
        tagName: "INPUT",
        textSnippet: "secret",
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
      category: "bug",
      comment: "x".repeat(2001),
    };
    expect(feedbackSchema.safeParse(input).success).toBe(false);
  });
});
