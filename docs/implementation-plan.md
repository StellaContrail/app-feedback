# Implementation plan

## Core use case

Users sign in with Google and open any HTTP(S) site in desktop Chrome. Each exact site origin is one shared review space, automatically created on the first comment. All authenticated users share feedback on that origin; normalized routes keep pages separate. Users select DOM elements and post feedback; fellow reviewers see numbered markers on the same elements. Unresolvable markers remain available in a list.

## Milestone 1 — vertical slice (Codex first task)

1. pnpm monorepo: apps/api, apps/extension, packages/shared. Strict TS, ESLint, Prettier, Vitest, GitHub Actions for lint/typecheck/tests.
2. D1 migrations: site participants, OAuth flows, unique sites and feedback. Google login and display name required, hashed Google subjects and expiring opaque tokens. No invitation, fixed destination, bootstrap or event expiry in the current flow (user-requested update). Preserve legacy private session data separately; do not automatically publish it.
3. Hono APIs defined in docs/api-contract.md. Validate Google token, site origin and normalized path, input sizes; authorized reads; join rate limiting and explicit extension-origin CORS policy.
4. Chrome MV3 user gesture -> inject on active HTTP(S) tab. Hover highlight, click to capture CSS selector, tag, small safe text snippet, normalized path and relative bounding box; Shadow DOM comment popover; background service worker handles API. Escape exits. Prevent selected element's native click action.
5. Pins rendered on the page; stale selectors safely fall back to a list. Handle SPA route/DOM changes with debounced updates and cleanup.
6. Tests for selector build/resolve, validation, auth, session isolation, URL origin/path, double injection and navigation cleanup; manual local test with two Chrome profiles.

### Acceptance criteria

- Reviewer A selects a button and posts feedback; reviewer B reloads the same site/page and sees a pin.
- Other origins and unrelated routes do not show that feedback. Legacy session comments are not published to site sharing.
- Selection does not navigate or submit forms; UI isolated from page CSS.
- No <all_urls> by default; no raw DOM, password value, or cookie persisted.
- Expired tokens rejected; legacy participant/invite/admin tokens cannot authorize site sharing.
- pnpm lint, pnpm typecheck and pnpm test pass.

## Milestone 2 — review management

Review management, expiration/deletion, JSON/CSV export. Site ownership, moderation and private groups require a separate authorization design; the current user-selected policy shares each site with all signed-in users.

## Milestone 3 — screenshots and polish

Opt-in visible-viewport screenshot with preview/redaction before upload, private R2 storage and access controls, MIME/size checks, Playwright E2E.

## Non-goals

Automatic forwarding of website reviews to GitHub Issues, AI fixes, source mapping, mobile, anonymous comments, unrestricted anonymous access, tracking.

## Decisions to verify

- Chrome extension origin CORS preflight to Workers.
- activeTab behavior across SPA navigation; request optional site permissions only if needed.
- Query-string/hash routing normalization.
- D1 SQLite migration/test setup.

## Security notes

Invite secrets revocable and hashed. Rate-limit by session/participant/IP to protect free tier. Never fetch arbitrary submitted URLs from the Worker; treat them only as origin/path identifiers. Comment length <= 2000, output escaped/text nodes only, no innerHTML injection.

## Extension feedback (user-requested addition)

The popup offers a collapsed feedback form for the extension itself, only after Google login. It opens a prefilled GitHub Issue editor in this repository with only the typed text and extension version. Users confirm and submit on GitHub. Website review data stays separate; there is no backend GitHub credential or automatic Issue creation.
