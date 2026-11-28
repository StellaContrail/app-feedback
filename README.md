# app-feedback

A privacy-conscious Chrome MV3 extension and Cloudflare Worker/D1 API for site-based reviews. Milestone 1 provides Google sign-in, element selection, comments, and shared numbered pins. There is no dashboard, AI, screenshot capture, R2, automatic deployment workflow, or public distribution.

Production API: https://api.example.com (Google authentication required for feedback).

For server hosting, see [Cloudflare Workers + D1 setup](docs/server-setup.md). A separate production configuration and an HTTPS API extension build are available; resource creation and deployment require approval.

## Workspace

- `packages/shared`: strict Zod schemas, route normalization and types.
- `apps/api`: Hono Worker, D1 migrations, local bootstrap and Workers-runtime integration tests.
- `apps/extension`: React login popup, isolated content UI and background API transport.
- `scripts/browser-smoke.mjs`: local two-profile Chrome acceptance smoke.

## Google sign-in

Google login is required before a participant token is issued. Open any HTTP(S) site and click the extension to view or write feedback. Sites are identified by their exact origin (scheme, hostname and port); feedback is separated by normalized pathname. All Google-authenticated users of the same API share feedback for the same site/page, subject to Google's audience/test-user restrictions. There are no events, invitations, registered base paths or fixed login destinations in the current flow. `DEFAULT_SESSION_ID` and `DEFAULT_APP_ID` are no longer used. The extension connects to a fixed API (`http://localhost:8787` by default).

Sites are created automatically on the first comment, not on an empty read. This is shared feedback, including for pages behind a site's own login: the API does not verify site ownership or the user's access to that site. Comments, saved target text and paths must be suitable for sharing with all app-feedback users. The popup and composer state that sharing scope.
The extension uses `chrome.identity.launchWebAuthFlow` with authorization code, S256 PKCE, state and nonce. The Worker exchanges the code and validates the Google ID token. It requests `openid profile` and uses the signed Google account name for display; missing names fall back to `Googleユーザー`. Names are bounded to 80 characters and never authorize access. Google tokens, email addresses and photos are not stored. D1 retains a hashed Google subject plus the account display name. That display name appears alongside the author’s comments and in pin details for other signed-in users. Logout revokes the app token, clears local credentials and enabled comment panels, and returns to the login screen. It does not sign Chrome out of Google.

Create a **Web application** OAuth client in Google Auth Platform. For every allowed extension ID, register `https://<extension-id>.chromiumapp.org/google` as an authorized redirect URI. Configure branding/audience and test users when the consent screen is in testing. Keep the client secret in the API's ignored `.dev.vars`, never the extension bundle or chat. See [Google login setup](docs/google-login.md). Missing configuration fails closed with 503; there is no anonymous/development auth bypass. Existing event/session tokens require a fresh Google login for site sharing. Legacy comments remain private in the old tables; migration does not automatically publish them.

## Local setup

Use Node.js 22 LTS and pnpm 10.9.0. All commands below run from the repository root. No Cloudflare account or cloud resource is needed. Wrangler and the test pool are pinned together for runtime compatibility; install from the committed lockfile.

```sh
pnpm install --frozen-lockfile
pnpm --filter @app-feedback/api migrate
pnpm --filter @app-feedback/extension build
```

No bootstrap or app URL registration is needed. The legacy bootstrap script remains only for old invitation-based API compatibility. New Google tokens last 24 hours and have no event/session expiry. Apply all migrations, including `0004_site_sharing.sql`, before starting the updated API.

1. In **two separate desktop Chrome profiles**, visit `chrome://extensions`, enable Developer mode and load unpacked `apps/extension/dist`.
2. Copy each extension ID from that page. In `apps/api/.dev.vars` set the explicit allowlist (comma separated, no wildcard):

   ```dotenv
   EXTENSION_ORIGINS="chrome-extension://<profile-A-extension-id>,chrome-extension://<profile-B-extension-id>"
   GOOGLE_CLIENT_ID="<web-application-client-id>.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="<server-only-client-secret>"
   ```

3. Start the local API:

   ```sh
   pnpm --filter @app-feedback/api dev --ip 127.0.0.1 --port 8787
   ```

4. Open any HTTP(S) site you want to review. The app is your own separately running HTTP(S) app; this repository does not start it. A minimal local fixture is available for testing:

   ```sh
   pnpm demo
   # Open http://localhost:4173/app for this fixture.
   ```

5. In profile A, open the extension and click **Googleでログイン**. Complete Google account selection/consent. No participation settings are required. The signed-in screen shows the Google account name and **コメントを開く**. On the chosen page, open comments and choose **＋ コメントを書く**, select an element, enter a comment and click **投稿する**. Choose a category with the three visible buttons (不具合 / 提案 / よかった点); 提案 is selected by default. Pins keep their numbers and use red / purple / green for those categories. Comment lists and pin details show the author’s Google display name, supplied by the server; no email or Google subject is returned.
6. In B, log in with another Google account and choose **コメントを開く** once on the same page. B sees the feedback and pins. The same tab restores viewing mode after same-origin navigation/reload/back without another popup click; refresh is every 15 seconds. Only **＋ コメントを書く** begins click-blocking selection.
7. Escape/**キャンセル** cancels selection while keeping comments visible. The panel's **×** or popup's **このタブの表示をやめる** stops this tab's automatic restoration. The **ログアウト** icon to the right of the account name hides all enabled panels and returns to **Googleでログイン**. Re-login preserves saved comments. Browser/extension restart requires login again. New tabs are never enabled automatically.

Restart the local API after changing `.dev.vars`. For Cloudflare hosting, use the separate production configuration and HTTPS extension build in [server setup](docs/server-setup.md), configure D1 and Google server secrets. No deployment or cloud resources are created by these build commands.
Clicking a comment in the page panel scrolls its saved target into view and highlights it, without activating the underlying link/button. Clicking a numbered page pin opens a nearby comment detail card; close it with × or Escape. The selected highlight follows scrolling and layout changes. An offscreen target can be reached from the list; a missing/changed target stays in the list without a guessed jump. Comment browsing is disabled while composing a draft so the draft is retained.

**一覧をコピー** copies the currently loaded page's feedback as readable JSON: normalized page URL, comment numbers, categories, bodies, timestamps and saved target selectors/tag/text snippets. It does not inspect additional page content, include auth/session credentials, contact an AI, or copy feedback from other routes. Comments are user-provided data. The list is capped at the latest 500 comments by the API. Clipboard copying uses a direct user click and requires HTTPS or localhost plus browser permission/focus; failure is shown in the panel. No clipboard-reading or additional extension permission is requested. See [Clipboard API requirements](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText).

Restoration is limited to the explicitly enabled tab, origin, API and current login. Before every injection the background worker checks authenticated API access and the live tab URL. Tab settings contain the origin, API and a hash identifying the current login, never raw tokens or page text; tokens stay in trusted session storage. Chrome's existing permissions remain authoritative: after visiting a different origin, a non-loopback site's activeTab grant is revoked and returning may require a new toolbar click. No extra host permission or all-sites access is requested. An explicitly hidden tab stays hidden after reload; closing the tab removes its restoration setting.

The default development build uses HTTP loopback (`localhost` / `127.0.0.1`). A server build pins requests and host permissions to the HTTPS API origin provided through `APP_FEEDBACK_API_ORIGIN`. The default manifest grants only loopback host permissions for the local API plus `activeTab`, `scripting` and `storage`; there are no default permissions for arbitrary review sites or automatic content scripts. To inspect a non-loopback app, click the toolbar popup on that page to grant `activeTab`. The configured API is never derived from the reviewed page or its messages.

## Feedback about the extension itself

After Google login, open the popup's **この拡張機能にフィードバック**, write up to 500 characters and choose **GitHubで確認する**. It opens a prefilled Issue editor in [StellaContrail/app-feedback](https://github.com/StellaContrail/app-feedback/issues). Review the content and submit on GitHub yourself; a GitHub account is required and submitted Issues are public. The entry is hidden while signed out or loading and disappears on logout. This is an in-app visibility rule; GitHub separately requires its own login for posting.

Only the typed text and installed extension version are placed in the GitHub URL. The extension does not attach the current page URL, saved reviews, Google name, credentials, screenshots or logs. The draft stays in popup memory and is lost when the popup closes; it is not saved to D1 or extension storage. No GitHub token, backend endpoint or extra extension permission is required. This uses [GitHub's Issue URL parameters](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue). It does not create an Issue until the user submits on GitHub, and normal website comments remain in app-feedback.

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

The optional smoke starts a local fixture and Worker, migrates an isolated temporary D1 database and opens two temporary Chrome profiles. It seeds already Google-associated app sessions directly into its temporary D1 database and trusted extension storage, then verifies A posting without submitting the selected form, B seeing a pin after automatic reload/back restoration, arbitrary same-origin path support, explicit-hide persistence, joined-popup simplification, stale selector fallback, double injection, removed-host cleanup, closed Shadow DOM/CSS isolation, SPA route isolation, Escape and absence of password/token data from feedback storage. It deletes its own temporary profiles/database at exit. It uses DevTools to operate the closed shadow UI, takes no screenshots and publishes nothing. Real Google account selection/consent is not exercised by that seeded-session UI smoke; OAuth signatures/state/PKCE and failure cases are covered in the Worker and extension tests with generated test keys and mocked Google responses. There is no auth-bypass endpoint or runtime flag in the application. The fixture is covered by loopback host permission, so this smoke **does not verify toolbar-granted activeTab on a non-loopback site**.

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
- Google login flows expire after five minutes and are consumed once. Their state and nonce are hashed in D1. Logout revokes the app token without deleting feedback; it does not sign the browser out of Google. If the API cannot be reached during logout, local credentials are cleared and the server token expires on its normal deadline.
- Participant bearer tokens remain in extension session storage with access restricted to trusted extension contexts. Content scripts receive feedback, not credentials. API requests omit cookies, disallow redirects and have a timeout. The API hashes all generated secrets/tokens at rest; logs do not include bodies, invite codes or authorization headers.
- Google-issued app token expiry is checked on every feedback request. The server derives the exact site origin and normalized route from the validated URL. All signed-in users can read and write all sites; there is no site ownership or invitation gate. CORS is a browser policy, not proof that a request came from a real tab; the extension also checks message sender/frame and route.
- Query strings and fragments are discarded before extension API requests and never identify routes. `/app/` and `/app` are the same route; URL dot segments normalize; ambiguous encoded slash/backslash paths are rejected. **Hash routers and apps whose distinct screens depend on queries are not supported.** Paths themselves may contain identifiers; review only suitable pages. The server never fetches submitted URLs.
- Positional selectors can become stale after DOM changes. Resolution requires exactly one matching element, the original tag and (when captured) identical safe text; otherwise comments remain in the list. Identical elements reordered at the same position can still be confused. Iframes, page shadow trees, canvas elements as internal targets and cross-origin embedded content are unsupported. Pins follow the current element rather than guessing from a stale rectangle.
- DOM/scroll/resize updates are debounced at 100 ms; Passive SPA path changes are checked every 250 ms; selection, submission and asynchronous responses also check the live URL immediately, discard stale responses and clear old-route drafts. Removing the injected host or leaving the document releases all selection listeners and timers. Avoid reviewing adversarial pages: Shadow DOM isolates CSS and normal DOM access, but it cannot stop the host page from removing an injected host or running pre-existing event handlers ahead of the selector.
- Google login limits: 10 starts/IP/minute and 10 completions/IP/minute; participant feedback requests: 120/minute. Fixed windows allow boundary bursts and shared NAT users share a budget. D1 stores only short-lived hashed bucket identifiers, pruned on later requests. CF-Connecting-IP is trusted only behind Cloudflare; local callers can spoof it. No public-service hardening or distributed load test is claimed.
- Reads return the latest 500 items per route in chronological order. Review management, revocation UI, deletion/export, public distribution and managed deployment remain later work. Legacy invitation/session tables and endpoints are retained for compatibility, isolated from site sharing; no old comments or credentials are copied into the shared tables.
