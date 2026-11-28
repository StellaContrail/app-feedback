import { z } from "zod";

// Queries and fragments never identify a feedback route or reach storage.
export function pageIdentity(raw: string): { origin: string; path: string } {
  if (raw.length > 2048) throw new Error("URL too long");
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Expected an HTTP(S) URL without credentials");
  }
  if (/%2f|%5c/i.test(url.pathname)) throw new Error("Ambiguous path");
  return { origin: url.origin, path: normalizePath(url.pathname) };
}
export function normalizePath(raw: string): string {
  if (
    raw.length > 2048 ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[?#\\]/.test(raw) ||
    Array.from(raw).some((c) => c.charCodeAt(0) < 32)
  ) {
    throw new Error("Invalid path");
  }
  const path = new URL(raw, "https://route.invalid").pathname;
  if (/%2f|%5c/i.test(path)) throw new Error("Ambiguous path");
  return path.replace(/\/+$/, "") || "/";
}
export function withinBase(path: string, base: string): boolean {
  return base === "/" || path === base || path.startsWith(`${base}/`);
}
const bounded = (max: number) => z.string().trim().min(1).max(max);
export const joinSchema = z
  .object({ inviteCode: bounded(256), displayName: bounded(80) })
  .strict();
export const siteGoogleStartSchema = z
  .object({
    redirectUri: z.string().url().max(512),
    codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const googleStartSchema = joinSchema
  .extend({
    redirectUri: z.string().url().max(512),
    codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const googleJoinSchema = z
  .object({
    flowId: z.string().uuid(),
    state: z.string().regex(/^[a-f0-9]{64}$/),
    code: bounded(2048),
    codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  })
  .strict();
export const googleSessionSchema = z
  .object({
    participantId: z.string().uuid(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.string().datetime(),
    authProvider: z.literal("google"),
    displayName: bounded(80),
  })
  .strict();
export const siteGoogleSessionSchema = googleSessionSchema
  .extend({ scope: z.literal("sites") })
  .strict();
const ratio = z.number().finite().min(0).max(1);
export const targetSchema = z
  .object({
    selector: bounded(512).regex(
      /^html(?: > [a-z][a-z0-9-]*:nth-of-type\([1-9][0-9]{0,5}\)){1,40}$/,
    ),
    tagName: z
      .string()
      .regex(/^[A-Z][A-Z0-9-]{0,49}$/)
      .refine(
        (s) =>
          ![
            "INPUT",
            "TEXTAREA",
            "SELECT",
            "OPTION",
            "SCRIPT",
            "STYLE",
            "IFRAME",
          ].includes(s),
      ),
    textSnippet: z.string().max(120),
    rect: z
      .object({ x: ratio, y: ratio, width: ratio, height: ratio })
      .strict(),
  })
  .strict();
export const feedbackSchema = z
  .object({
    pageUrl: z
      .string()
      .max(2048)
      .refine((s) => {
        try {
          pageIdentity(s);
          return true;
        } catch {
          return false;
        }
      }),
    target: targetSchema,
    category: z.enum(["bug", "suggestion", "praise"]),
    comment: bounded(2000),
  })
  .strict();
export type Target = z.infer<typeof targetSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;
export interface FeedbackItem {
  id: string;
  authorName?: string;
  target: Target;
  category: FeedbackInput["category"];
  comment: string;
  createdAt: string;
}

export const siteFeedbackQuerySchema = z
  .object({ pageUrl: feedbackSchema.shape.pageUrl })
  .strict();

export const logoutSchema = z.object({}).strict();
