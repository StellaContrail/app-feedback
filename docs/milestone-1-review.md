# Milestone 1 implementation review

## Baseline and scope

Started from `chore/codex-starter`: only README, instructions, API/implementation drafts and the initial D1 schema existed. No runnable API/extension, package management or tests existed. Implemented only Milestone 1. No deployment, cloud resource, public distribution, PR, merge, dashboard, screenshot, R2 or AI work was performed.

## Review order

1. `package.json`, workspace/config/lockfile and `.github/workflows/ci.yml`: strict TypeScript, lint/format, isolated test packages and local builds. CI has read-only repository permissions and no deploy step.
2. `packages/shared/src/index.ts`: canonical routes, base-path boundaries, bounded strict input contracts. Query/hash discarded; hash/query routers intentionally unsupported.
3. `apps/api/migrations/0002_request_limits.sql`, `apps/api/src/index.ts` and `apps/api/scripts/bootstrap.mjs`: initial migration preserved, hashed expiring credentials, membership-protected reads/writes, exact-origin CORS, bounded streaming JSON and persistent limits. Bootstrap is file generation only, with explicit local migration/SQL commands.
4. `apps/extension/src/background.ts`, `protocol.ts`, `popup.tsx`: user-triggered activation, trusted popup actions, top-frame sender/route checks, session-only token storage and local API transport without cookies or redirects.
5. `selector.ts`, `controller.ts`, `content.ts`: attribute-free selectors, safe text capture, closed Shadow DOM, click/default-action suppression, pins/list, debounced DOM updates, SPA polling, stale-response guards and cleanup.
6. Tests under all three packages, `scripts/browser-smoke.mjs` and the manual checklist: executable evidence plus explicit remaining acceptance work.

## Decisions clarifying the draft

- GET requires `pageUrl` as well as `path` to check origin. Membership applies to the whole session, never client roles.
- Selectors are restricted positional CSS paths instead of the draft's data-attribute selector. This avoids copying potentially sensitive identifiers/attributes. Tag and safe text further constrain resolution; stale/ambiguous results stay in the list.
- Runtime and test-tool versions are pinned compatibly; API builds use `wrangler deploy --dry-run` only. Local database ID is a non-deployable placeholder.
- The extension is local-API-only. Loopback host permissions support API fetch; arbitrary reviewed sites use activeTab after a user click. No optional all-sites permission was added.
- Form controls/private/editable areas are deliberately ineligible. Snippets are only safe direct text; no DOM serialization or field-value API is used.
- Join attempts are limited by IP and session; feedback traffic by participant. Reads are capped to the latest 500 items per route to bound response/DOM work.

## Evidence and remaining work

Local verification completed with Node.js 23.9.0, pnpm 10.9.0 and Chrome 145.0.7632.75 (CI is configured for Node 22 LTS):

| Command                 | Result                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm lint`             | Passed: ESLint and Prettier                                                                         |
| `pnpm typecheck`        | Passed: strict TS in all three packages, including tests                                            |
| `pnpm test`             | Passed: 61 tests (shared 4, extension 36, Worker/D1 19, bootstrap 2)                                |
| `pnpm build`            | Passed: extension bundle and Worker dry-run, no deploy                                              |
| `pnpm test:browser`     | Passed: two independent Chrome profiles, local Worker/D1                                            |
| `pnpm test:permissions` | Passed: native action-granted activeTab, two profiles, CSS/host cleanup and cross-origin revocation |
| `git diff --check`      | Passed                                                                                              |

Workers tests run against D1 in workerd with applied real migrations, not a mocked SQL adapter. The Chrome smoke uses two temporary profiles and a real local Worker/D1. Workerd/Chrome required permission to spawn outside the filesystem/network sandbox. Dependency installation reported deprecation warnings for the pinned legacy test-pool/tooling; no test/build failure remains. CI itself has not been run remotely.

Changes remain uncommitted in the requested branch; no push, PR, merge or deployment was performed. `docs/implementation-plan.md` has formatting-only changes from Prettier; the milestone scope and acceptance criteria are unchanged.

The next acceptance step is the human checklist's **toolbar click and visual checks in the intended app**. Browser permission behavior is now covered separately by the native-action test below. No human manual result is claimed.

Known limitations are detailed in README: positional selector drift, unsupported iframe/shadow targets and hash/query routers, up to 250 ms passive route detection, 500-item cap, fixed-window/NAT rate limits, visible-text privacy, no production hardening or revocation UI. An authorized participant can query any registered route/app in their session; CORS and client page identifiers do not provide cryptographic tab attestation.

## Native activeTab coverage

Added `test:permissions`, a mode of `scripts/browser-smoke.mjs`, plus `scripts/chrome-action.py`. It uses an isolated Xvfb display and two independent Chrome profiles; `review.test` and `other.test` are mapped only inside those Chrome processes to a local fixture. Neither origin matches the production host permissions. A copied temporary manifest gets only a native extension-action shortcut, with no new permission. The helper requires a matching browser PID, random page title and input focus before sending any key. The suite never sends keys to the existing desktop, captures no screenshots, and does not publish anything.

Verified for both reviewers: Chrome rejects injection before the action (including a programmatic popup-page activate message); a real native action grants activeTab; a trusted popup-page message can then inject the production content script; A posts without submitting the form; B sees the pin after reload; same-origin SPA/reload retains the grant; another origin revokes the grant, including after returning to the original origin. Existing double-injection, stale-selector, route, Escape and storage assertions also run in this mode.

The native action test is automated permission evidence, not a human toolbar-click or visual review. The actual action popup's visual interaction is not asserted; injection after granting permission is driven from the authenticated extension popup page. The permission test does not patch the production application or production manifest. Lint ignores the already gitignored `.local` test-tool directory so local dependency packages are never treated as project source.

The native test uses Chrome 145.0.7632.75 and user-owned conda-forge Xvfb 21.1.26, xkbcomp 1.5.0 and xkeyboard-config 2.48. These optional tools live entirely in the gitignored `.local` directory; no system package or shell configuration was changed. See README for prerequisites and the user-mode setup command.

## Lifecycle and SPA regression fixes

`controller.ts` now releases listeners/timers if the host leaves the active document, including before a subsequent input event can be intercepted. Mutation observation also detects removal without user input. A fresh activation works after removal, and ordinary native form submission resumes. This prevents an invisible selection mode from blocking the host page after a DOM replacement.

Route checks now run against the live URL before selection/submission and when reads or posts complete, alongside the existing 250 ms passive poll. An old-route read cannot render merely because the poll has not fired, an old draft cannot be sent after pushState, and a completed old-route post cannot trigger an old-route reload. In-flight posts already sent before navigation may finish on their original route; their completions do not overwrite the new route's UI.

Five regression tests reproduced these failures before the fix and pass afterward. The two real-Chrome suites additionally remove the host and verify native form submission/reinjection, and apply aggressive page CSS while comparing the panel's computed styles before/after to prove isolation without screenshots. Human visual review remains separate.

## Trial feedback: simpler UI and navigation continuity

A joined popup now has one entry button, **コメントを開く**. Writing starts from **＋ コメントを書く** inside the page panel, so opening comments does not require a view/write decision or intercept page clicks. Joining fields are absent after joining, and stop/leave actions are tucked under **参加設定**. Viewing mode never intercepts page clicks. Element selection begins only on the write action, and its comment form/category controls appear only when needed; Escape/cancel returns to viewing instead of removing the comments. The redundant panel reload action was removed; periodic refresh and reopening the view still retrieve comments.

The background worker records explicit opt-in per tab in session storage, bound to origin, API, app and session. A top-frame completed navigation triggers membership/registered-route authorization and a live-URL check before reinjection in viewing mode. A command guard in the content entrypoint prevents injection on a route changed between scripting calls. Hiding, leaving, expiration, wrong origins, unrelated routes and stale authorization must not enable automatic display. Browser permission enforcement is unchanged: cross-origin activeTab revocation may still require a fresh user action on a non-loopback site. No permission was added to the manifest.

Unit/DOM coverage includes joined-state UI, view/write separation, Escape, opt-in restoration, wrong origins, route authorization, stopped/forgotten sessions and disabling during in-flight authorization. Both real-Chrome modes verify reload, link navigation and back without repeated activation, out-of-base-path exclusion, explicit-hide persistence, and the existing privacy/CSS/selection checks. The local trial is reopened with the new UI; its D1 feedback is retained.

## Popup and comment-panel visual refinement

`ui-styles.ts` and `ui-icons.ts` provide a shared restrained violet/neutral palette, local system fonts and code-native SVG icons. The joined popup keeps its single **コメントを開く** action, with a clearer button hierarchy, compact participant identity and quieter collapsed settings. The loading, join, error, hover and keyboard-focus states use the same styling; reduced-motion preferences are respected.

The Shadow DOM panel uses a light border and shadow, a clear header/close target, and comment cards separating number, category and body. User comments remain text nodes with line breaks preserved. Selecting a pin highlights its corresponding card instead of copying the whole comment into the status line. Comment rows are replaced as one fragment so layout reads do not clear the list mid-update.

The existing Chrome smoke now checks the joined popup fits within 360 × 420 CSS pixels without horizontal overflow and verifies at least 4.5:1 contrast for the primary action text, in addition to host-page CSS isolation and all posting/navigation checks. These are computed-layout checks, not screenshots or a claim of a complete accessibility audit. No external fonts/images, permissions or API changes were added.

## Mandatory Google login

The user explicitly changed the original account-free requirement. `google-auth.ts`, `crypto.ts`, the shared schemas, migration `0003_google_login.sql`, and the extension's `google-login.ts` implement authorization-code login with S256 PKCE, state and nonce. The server exchanges codes, validates Google's RS256 ID-token signature/issuer/audience/presenter/expiry/nonce, and only then issues its own hashed opaque participant token. Google tokens are not saved; the minimal persisted identity is a Google-subject hash and the chosen nickname. Invite and session checks remain necessary.

All authenticated API requests reject legacy participants without the verified Google marker. Missing OAuth settings fail closed; there is no test-mode authentication bypass. The migration preserves previous comments. Logout invalidates the app token without deleting its author/comment rows. New identity permission is used only for a user-initiated Google window; host permissions remain unchanged. The client secret stays in ignored server configuration and is never bundled in the extension.

Worker tests use generated signing keys and intercepted Google endpoints, including successful login, issuer/audience/nonce/expiry/signature failures, wrong state/PKCE, replay, expired/wrong-session flows, revoked invites, unconfigured OAuth, old anonymous tokens and logout preservation. Extension tests validate Google-only redirects, callback/state/PKCE/cancellation, missing server Google confirmation, and old cached participation. Browser UI tests now seed authenticated app sessions directly in isolated test D1/storage and do not claim to exercise real Google consent. The real Google account flow is the remaining human acceptance step.

## Fixed destination and Google account names

The user confirmed real Windows Chrome Google login and then requested removal of all participation settings. The current popup has a single Google login button while signed out, account identity and comments action while signed in, and a visible logout action. Logout hides tracked page UIs, revokes the app token and returns to login. No API URL, invitation, nickname or session/app inputs remain.

The API chooses `DEFAULT_SESSION_ID` / `DEFAULT_APP_ID`, checks app membership/session expiry and issues a participant only after Google verification. This intentionally permits any Google-authenticated account at this fixed destination; it is not an invite/account allowlist. Legacy invitation endpoints remain compatible and other sessions stay isolated. The extension contains only the fixed local API origin, no invite or admin secrets. Production HTTPS/hosting configuration remains future work.

The `openid profile` scope supplies the signed account name; names never establish identity, are bounded to 80 characters and default to `Googleユーザー` when absent. Email/photos/Google tokens are not persisted. Workers/D1 coverage verifies server-selected destinations, rejected client overrides, missing/invalid/expired destinations, Google names instead of client names, logout token rejection, and preserved comments after re-login. DOM tests cover the no-input login/logout/cancellation UI. Real-account acceptance of this updated flow remains manual.

## Comment navigation, pin details and copy

The controller now uses stable comment buttons/pins keyed by feedback ID, preserving keyboard focus during scroll/resize updates. List activation re-resolves the saved selector, scrolls to the target and highlights its current bounds. Pin activation opens a text-only detail card. Missing targets remain in the list; offscreen targets are distinguished from unavailable ones. New browsing actions check the current route immediately, and route changes/close/selection clear active details. Composing a draft disables browsing rather than discarding it.

A one-click copy action exports readable JSON for the current authorized list (up to 500 items), using only normalized URL and explicitly selected saved feedback/target fields. It adds no auth data, live DOM capture, AI call or extension permission. HTTPS/localhost clipboard/focus restrictions are surfaced as errors. Unit/DOM tests cover offscreen jumps, stale targets/routes, highlight alignment, stable focus, text-only previews, clipboard success/failure and export field privacy. Chrome smoke additionally exercises actual pointer clicks, scrolling without native form submission, pin details and clipboard contents on localhost; the native non-loopback permission suite does not claim clipboard support on insecure HTTP.
