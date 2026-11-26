import { pageIdentity, type FeedbackItem } from "@app-feedback/shared";

// Export already-authorized feedback only, without inspecting the live DOM.
export function feedbackExport(pageUrl: string, items: FeedbackItem[]): string {
  const page = pageIdentity(pageUrl);
  return JSON.stringify(
    {
      pageUrl: page.origin + page.path,
      feedback: items.map((item, index) => ({
        number: index + 1,
        category: item.category,
        comment: item.comment,
        target: {
          selector: item.target.selector,
          tagName: item.target.tagName,
          textSnippet: item.target.textSnippet,
        },
        createdAt: item.createdAt,
      })),
    },
    null,
    2,
  );
}
