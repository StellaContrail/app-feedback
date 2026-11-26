# Implementation plan

## Core use case

An organizer creates an event session and registers web app URLs. Friends open each other's apps in desktop Chrome, select DOM elements, and post feedback; fellow reviewers see numbered markers on the same elements. Unresolvable markers remain available in a list.

## Milestone 1 — vertical slice (Codex first task)

1. pnpm monorepo: apps/api, apps/extension, packages/shared. Strict TS, ESLint, Prettier, Vitest, GitHub Actions for lint/typecheck/tests.
2. D1 migrations: sessions, apps, participants, feedback. Google account login required with a server-configured fixed destination and Google display name (user-requested update); hashed invite/admin secrets, hashed Google subject and expiring opaque participant tokens; minimal local bootstrap script (no dashboard).
3. Hono APIs defined in docs/api-contract.md. Validate membership, registered app origin and path, input sizes; authorized reads; join rate limiting and explicit extension-origin CORS policy.
4. Chrome MV3 user gesture -> inject on active HTTP(S) tab. Hover highlight, click to capture CSS selector, tag, small safe text snippet, normalized path and relative bounding box; Shadow DOM comment popover; background service worker handles API. Escape exits. Prevent selected element's native click action.
5. Pins rendered on the page; stale selectors safely fall back to a list. Handle SPA route/DOM changes with debounced updates and cleanup.
6. Tests for selector build/resolve, validation, auth, session isolation, URL origin/path, double injection and navigation cleanup; manual local test with two Chrome profiles.

### Acceptance criteria

- Reviewer A selects a button and posts feedback; reviewer B reloads the same registered page and sees a pin.
- Other sessions, origins and unrelated routes cannot see that feedback.
- Selection does not navigate or submit forms; UI isolated from page CSS.
- No <all_urls> by default; no raw DOM, password value, or cookie persisted.
- Expired tokens rejected; invite/admin tokens not usable as participant bearer tokens.
- pnpm lint, pnpm typecheck and pnpm test pass.

## Milestone 2 — review management

Dashboard to create sessions/register apps, browse feedback by app, categorize as bug/suggestion/praise and organizer-only change status; expiration/deletion, JSON/CSV export. Session-selection/invitation policy can be revisited when multi-session management is implemented; current login uses the operator-configured destination.

## Milestone 3 — screenshots and polish

Opt-in visible-viewport screenshot with preview/redaction before upload, private R2 storage and access controls, MIME/size checks, Playwright E2E.

## Non-goals

GitHub Issues, AI fixes, source mapping, mobile, public comments, unrestricted anonymous access, tracking.

## Decisions to verify

- Chrome extension origin CORS preflight to Workers.
- activeTab behavior across SPA navigation; request optional site permissions only if needed.
- Query-string/hash routing normalization.
- D1 SQLite migration/test setup.

## Security notes

Invite secrets revocable and hashed. Rate-limit by session/participant/IP to protect free tier. Never fetch arbitrary submitted URLs from the Worker; treat them only as origin/path identifiers. Comment length <= 2000, output escaped/text nodes only, no innerHTML injection.
