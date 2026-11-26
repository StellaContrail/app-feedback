# app-feedback

A privacy-conscious Chrome MV3 extension and Cloudflare Worker/D1 API for small app-review sessions. Milestone 1 provides joining, element selection, comments, and shared numbered pins. There is no dashboard, AI, screenshot capture, R2, deployment workflow, or public distribution.

## Workspace

- `packages/shared`: strict Zod schemas, route normalization and types.
- `apps/api`: Hono Worker, D1 migrations, local bootstrap and Workers-runtime integration tests.
- `apps/extension`: React login popup, isolated content UI and background API transport.
- `scripts/browser-smoke.mjs`: local two-profile Chrome acceptance smoke.

## Google sign-in

Google login is required before a participant token is issued. Users do not enter an API URL, session/app IDs, invitation or nickname. The extension connects to a fixed API (`http://localhost:8787` for local development); the server selects the review destination with `DEFAULT_SESSION_ID` and `DEFAULT_APP_ID`. Any successfully authenticated Google account can join this configured destination, subject to Google's audience/test-user restrictions. This is an explicit operator-selected access policy, not an invitation gate. Other sessions remain isolated and invitation-based API endpoints remain for compatibility.

The extension uses `chrome.identity.launchWebAuthFlow` with authorization code, S256 PKCE, state and nonce. The Worker exchanges the code and validates the Google ID token. It requests `openid profile` and uses the signed Google account name for display; missing names fall back to `Googleユーザー`. Names are bounded to 80 characters and never authorize access. Google tokens, email addresses and photos are not stored. D1 retains a hashed Google subject plus the account display name. Logout revokes the app token, clears local credentials and enabled comment panels, and returns to the login screen. It does not sign Chrome out of Google.

Create a **Web application** OAuth client in Google Auth Platform. For every allowed extension ID, register `https://<extension-id>.chromiumapp.org/google` as an authorized redirect URI. Configure branding/audience and test users when the consent screen is in testing. Keep the client secret in the API's ignored `.dev.vars`, never the extension bundle or chat. See [Google login setup](docs/google-login.md). Missing configuration fails closed with 503; there is no anonymous/development auth bypass. Existing anonymous tokens stop working after migration; existing comments remain.

## Local setup

Use Node.js 22 LTS and pnpm 10.9.0. All commands below run from the repository root. No Cloudflare account or cloud resource is needed. Wrangler and the test pool are pinned together for runtime compatibility; install from the committed lockfile.

```sh
pnpm install --frozen-lockfile
pnpm --filter @app-feedback/api migrate
# Pass the app URL to review; its path becomes the registered base path.
pnpm --filter @app-feedback/api bootstrap http://localhost:4173/app
pnpm --filter @app-feedback/api exec wrangler d1 execute feedback --local --file .local/bootstrap.sql
pnpm --filter @app-feedback/extension build
```

Bootstrap writes private, gitignored files in `apps/api/.local/`: `credentials.json` contains the session ID, app ID, invite code and future admin secret; `bootstrap.sql` contains hashes only. Files are created with mode 0600 and refuse to overwrite existing files. Do not share the admin secret, commit credentials, paste them into logs, or rerun bootstrap for each reviewer. Both reviewers use the same session/app/invite. Sessions last seven days; newly issued participant tokens last at most 24 hours, capped by session expiry. Bootstrap generates files only; it does not execute SQL or contact Cloudflare.

1. In **two separate desktop Chrome profiles**, visit `chrome://extensions`, enable Developer mode and load unpacked `apps/extension/dist`.
2. Copy each extension ID from that page. In `apps/api/.dev.vars` set the explicit allowlist (comma separated, no wildcard):

   ```dotenv
   EXTENSION_ORIGINS="chrome-extension://<profile-A-extension-id>,chrome-extension://<profile-B-extension-id>"
   GOOGLE_CLIENT_ID="<web-application-client-id>.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="<server-only-client-secret>"
   DEFAULT_SESSION_ID="<sessionId from local credentials.json>"
   DEFAULT_APP_ID="<appId from local credentials.json>"
   ```

3. Start the local API:

   ```sh
   pnpm --filter @app-feedback/api dev --ip 127.0.0.1 --port 8787
   ```

4. Open the app URL registered during bootstrap. The app is your own separately running HTTP(S) app; this repository does not start it. A minimal local fixture is available for testing:

   ```sh
   pnpm demo
   # Use http://localhost:4173/app as the bootstrap URL for this fixture.
   ```

5. In profile A, open the extension and click **Googleでログイン**. Complete Google account selection/consent. No participation settings are required. The signed-in screen shows the Google account name and **コメントを開く**. On the registered page, open comments and choose **＋ コメントを書く**, select an element, enter a comment and click **投稿する**. Category selection is optional and collapsed by default.
6. In B, log in with another Google account and choose **コメントを開く** once on the same registered page. B sees the feedback and pins. The same tab restores viewing mode after same-origin navigation/reload/back without another popup click; refresh is every 15 seconds. Only **＋ コメントを書く** begins click-blocking selection.
7. Escape/**キャンセル** cancels selection while keeping comments visible. The panel's **×** or popup's **このタブの表示をやめる** stops this tab's automatic restoration. **ログアウト** hides all enabled panels and returns to **Googleでログイン**. Re-login preserves saved comments. Browser/extension restart requires login again. New tabs are never enabled automatically.

Server destination settings are configured once by the operator, including for debugging. Restart the local API after changing `.dev.vars`. Existing seven-day bootstrap sessions still expire; login fails closed for expired/missing/mismatched destinations. Cloudflare hosting remains planned: production will need an explicit HTTPS API origin in the extension transport and manifest permissions, D1 bindings, server secrets and a review of the Google-account access policy. No deployment or cloud resources are created by this change.

Clicking a comment in the page panel scrolls its saved target into view and highlights it, without activating the underlying link/button. Clicking a numbered page pin opens a nearby comment detail card; close it with × or Escape. The selected highlight follows scrolling and layout changes. An offscreen target can be reached from the list; a missing/changed target stays in the list without a guessed jump. Comment browsing is disabled while composing a draft so the draft is retained.

**一覧をコピー** copies the currently loaded page's feedback as readable JSON: normalized page URL, comment numbers, categories, bodies, timestamps and saved target selectors/tag/text snippets. It does not inspect additional page content, include auth/session credentials, contact an AI, or copy feedback from other routes. Comments are user-provided data. The list is capped at the latest 500 comments by the API. Clipboard copying uses a direct user click and requires HTTPS or localhost plus browser permission/focus; failure is shown in the panel. No clipboard-reading or additional extension permission is requested. See [Clipboard API requirements](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText).

Restoration is limited to the explicitly enabled tab, origin, session and app. Before every injection the background worker rechecks session membership and the registered origin/base path through the API and checks the live tab URL. Tab settings contain identifiers/origin only, never tokens or page text; tokens stay in trusted session storage. Chrome's existing permissions remain authoritative: after visiting a different origin, a non-loopback site's activeTab grant is revoked and returning may require a new toolbar click. No extra host permission or all-sites access is requested. An explicitly hidden tab stays hidden after reload; closing the tab removes its restoration setting.

The API origin is intentionally limited to HTTP loopback (`localhost` / `127.0.0.1`) for this milestone. The manifest grants only loopback host permissions for that API plus `activeTab`, `scripting` and `storage`; there are no default permissions for arbitrary review sites or automatic content scripts. To inspect a non-loopback app, click the toolbar popup on that page to grant `activeTab`. The configured API is never derived from the reviewed page or its messages.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# Optional: requires local Chrome with CDP Extensions.loadUnpacked support.
# CHROME_PATH may override /usr/bin/google-chrome.
pnpm test:browser
# Optional Linux/Xvfb native extension-action permission coverage.
pnpm test:permissions
```

`pnpm test` includes bootstrap credential-file tests, unit/DOM tests and real SQLite/D1 migrations and requests inside the Cloudflare Workers runtime, with isolated test storage. `pnpm build` only bundles the extension and performs a Worker **dry run**. CI runs these checks without credentials or deployment. Some sandbox environments require permission to spawn workerd/Chrome and bind loopback ports.

The optional smoke starts a local fixture and Worker, migrates an isolated temporary D1 database and opens two temporary Chrome profiles. It seeds already Google-associated app sessions directly into its temporary D1 database and trusted extension storage, then verifies A posting without submitting the selected form, B seeing a pin after automatic reload/back restoration, out-of-base-path exclusion, explicit-hide persistence, joined-popup simplification, stale selector fallback, double injection, removed-host cleanup, closed Shadow DOM/CSS isolation, SPA route isolation, Escape and absence of password/invite/admin data from feedback storage. It deletes its own temporary profiles/database at exit. It uses DevTools to operate the closed shadow UI, takes no screenshots and publishes nothing. Real Google account selection/consent is not exercised by that seeded-session UI smoke; OAuth signatures/state/PKCE and failure cases are covered in the Worker and extension tests with generated test keys and mocked Google responses. There is no auth-bypass endpoint or runtime flag in the application. The fixture is covered by loopback host permission, so this smoke **does not verify toolbar-granted activeTab on a non-loopback site**.

`pnpm test:permissions` additionally tests an origin **outside the extension's host permissions**: `review.test` resolves to the loopback fixture only inside the temporary Chrome processes. Both reviewers must fail injection before a native extension action. A test-only `Ctrl+Shift+Y` action shortcut is added to a temporary copy of the built manifest (no permission is added); XTest executes that action on a window matching both the browser PID and a random fixture title. The suite then checks real action-granted activeTab, A→D1→B, same-origin SPA/reload retention, and revocation after cross-origin navigation and return. Injection after the grant still uses a trusted extension popup-page message; the suite does not claim a human toolbar-click or visual result.

The permission suite requires Linux, Python 3, Xvfb with keyboard support (`xkbcomp`, `xkeyboard-config`), `libX11.so.6`, and `libXtst.so.6`. It launches its **own isolated Xvfb display**, disables TCP and filesystem X11 listeners (Linux abstract UNIX socket only), and sends no keys to the existing desktop. `XVFB_PATH` can override the `Xvfb` executable. A user-owned [conda-forge Xvfb environment](https://github.com/conda-forge/xorg-xvfb-server-feedstock) is an alternative when system packages are unavailable:

```sh
# Requires micromamba already available; no shell initialization or sudo needed.
micromamba create --prefix "$PWD/.local/browser-tools" --channel conda-forge --override-channels --yes xorg-xvfb-server xkeyboard-config
XVFB_PATH="$PWD/.local/browser-tools/bin/Xvfb" pnpm test:permissions
```

The production manifest and application source are not modified by this test. Temporary displays, profiles, the copied manifest and D1 storage are cleaned up afterward. This optional suite is separate from `pnpm test` and CI because it requires the native Linux test dependencies. Human toolbar-click/visual acceptance in the intended app remains the next check.

See [the API contract](docs/api-contract.md), [manual acceptance checklist](docs/manual-test.md) and [implementation review](docs/milestone-1-review.md) for scope, evidence and remaining acceptance work.

## Privacy and limitations

- The Worker stores only selector, tag, up to 120 characters of direct text, viewport-relative rectangle, normalized path, category and comment. Selector construction copies no IDs, attributes or field values. Form controls, editable/private/hidden regions, scripts and frames are excluded; descendants of those regions are also excluded. It never reads cookies, HTML serialization, form values or page auth headers. User-written comments and ordinary visible text can still contain personal information; only review pages suitable for sharing, and mark sensitive regions `data-private`.
- Google login flows expire after five minutes and are consumed once. Their state/nonce and invite secrets are hashed in D1. Logout revokes the app token without deleting feedback; it does not sign the browser out of Google. If the API cannot be reached during logout, local credentials are cleared and the server token expires on its normal deadline.
- Participant bearer tokens remain in extension session storage with access restricted to trusted extension contexts. Content scripts receive feedback, not credentials. API requests omit cookies, disallow redirects and have a timeout. The API hashes all generated secrets/tokens at rest; logs do not include bodies, invite codes or authorization headers.
- Membership and session/token expiry are checked on every feedback request. Reads and writes validate registered origin and a segment-boundary base path; reads return only the exact normalized route. Participants can review all apps in their session. CORS is a browser policy, not proof that a request came from a real tab; the extension also checks message sender/frame and route.
- Query strings and fragments are discarded before extension API requests and never identify routes. `/app/` and `/app` are the same route; URL dot segments normalize; ambiguous encoded slash/backslash paths are rejected. **Hash routers and apps whose distinct screens depend on queries are not supported.** Paths themselves may contain identifiers; register only suitable apps. The server never fetches submitted URLs.
- Positional selectors can become stale after DOM changes. Resolution requires exactly one matching element, the original tag and (when captured) identical safe text; otherwise comments remain in the list. Identical elements reordered at the same position can still be confused. Iframes, page shadow trees, canvas elements as internal targets and cross-origin embedded content are unsupported. Pins follow the current element rather than guessing from a stale rectangle.
- DOM/scroll/resize updates are debounced at 100 ms; Passive SPA path changes are checked every 250 ms; selection, submission and asynchronous responses also check the live URL immediately, discard stale responses and clear old-route drafts. Removing the injected host or leaving the document releases all selection listeners and timers. Avoid reviewing adversarial pages: Shadow DOM isolates CSS and normal DOM access, but it cannot stop the host page from removing an injected host or running pre-existing event handlers ahead of the selector.
- Join limits: 10 attempts/IP/minute and 60/session/minute; participant feedback requests: 120/minute. Fixed windows allow boundary bursts and shared NAT users share a budget. D1 stores only short-lived hashed bucket identifiers, pruned on later requests. CF-Connecting-IP is trusted only behind Cloudflare in a future deployment; local callers can spoof it. No public-service hardening or distributed load test is claimed.
- Reads return the latest 500 items per route in chronological order. Review management, revocation UI, deletion/export, production API permissions, packaging and deployment remain later work. An organizer can revoke an invite by replacing its hash and expire a session in local D1; there is no admin bearer endpoint in this milestone.
