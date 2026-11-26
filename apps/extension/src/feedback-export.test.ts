import { expect, it } from "vitest";
import { feedbackExport } from "./feedback-export";
import type { FeedbackItem } from "@app-feedback/shared";
it("copies only the current route and explicitly allowed saved feedback fields", () => {
  const item: FeedbackItem = {
    id: "private-id",
    category: "bug",
    comment: "複数行\n<script>text only</script>",
    createdAt: "2026-11-26T00:00:00.000Z",
    target: {
      selector: "html > body:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "BUTTON",
      textSnippet: "保存",
      rect: { x: 0, y: 0, width: 0.1, height: 0.1 },
    },
  };
  Object.assign(item, { token: "private-token", authorEmail: "private-email" });
  Object.assign(item.target, {
    outerHTML: "private-dom",
    value: "private-input",
  });
  const result = feedbackExport(
    "https://example.com/app/?secret=query#private",
    [item],
  );
  expect(JSON.parse(result)).toEqual({
    pageUrl: "https://example.com/app",
    feedback: [
      {
        number: 1,
        category: "bug",
        comment: item.comment,
        createdAt: item.createdAt,
        target: {
          selector: item.target.selector,
          tagName: "BUTTON",
          textSnippet: "保存",
        },
      },
    ],
  });
  for (const secret of [
    "private-token",
    "private-email",
    "private-dom",
    "private-input",
    "private-id",
    "secret=query",
    "#private",
  ])
    expect(result).not.toContain(secret);
});
