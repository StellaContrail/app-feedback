# Google login setup and acceptance

A Google account is required. The popup uses a server-configured fixed review destination without invitation or nickname inputs. This implements the user's change to the original account-free draft. No dashboard or public deployment is involved.

## Configure Google and the local API

1. In [Google Auth Platform](https://console.cloud.google.com/auth/clients), select/create your project and configure branding/audience. When using testing mode, add the Google accounts that will test the app.
2. Create an OAuth client of type **Web application**. The server exchanges authorization codes; the secret must not be distributed with the extension.
3. Load `apps/extension/dist` unpacked and note its extension ID. Register exactly `https://<extension-id>.chromiumapp.org/google` under the client's authorized redirect URIs. The committed manifest public key fixes the development ID to `ijagaijpoccamffckkbfppnilhpblekc`, including when the build is copied to Windows. Register `https://ijagaijpoccamffckkbfppnilhpblekc.chromiumapp.org/google` and allow `chrome-extension://ijagaijpoccamffckkbfppnilhpblekc` in `EXTENSION_ORIGINS`. The public key is not an OAuth secret. Restart the local API after changing `.dev.vars`.
4. Add these lines to `apps/api/.dev.vars`, retaining the exact `EXTENSION_ORIGINS` allowlist:

   ```dotenv
   GOOGLE_CLIENT_ID="<web-application-client-id>.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="<server-only-secret>"
   DEFAULT_SESSION_ID="<existing review session ID>"
   DEFAULT_APP_ID="<app ID in that session>"
   ```

   Do not paste the secret into chat or commit it. Future production configuration must use Worker secrets. No production deployment is authorized here.

5. After editing `.dev.vars`, restart the local API so the new OAuth values are loaded; an API process started before the change can still report `AUTH_NOT_CONFIGURED`. Run `pnpm --filter @app-feedback/api migrate`, build the extension, and restart/reload it so the new `identity` permission and login code are loaded. Start the local API as described in README. The existing participant tokens cannot be reused without Google confirmation, but saved comments are retained.
6. Click **Googleでログイン**. Complete Google account selection/consent yourself. Google passwords and second factors are entered only on Google's own pages. Once joined, **コメントを開く** returns to the ordinary review flow.

## Security and privacy

The extension generates a 256-bit PKCE verifier in memory and uses `chrome.identity.getRedirectURL('google')` / `launchWebAuthFlow`. A five-minute server flow binds the destination session, current invite-hash revision, allowed redirect, state, nonce and S256 challenge. State, nonce and invite secrets are hashed at rest. Callback origin/path, state and duplicate parameters are checked before the returned code is sent to the API. Consuming the flow is atomic and prevents replay.

Only the API exchanges the code, using a fixed Google token endpoint and the server-only client secret. Redirect responses are not followed with that secret. `jose` verifies the ID token with Google's fixed public-key endpoint, allowing only RS256 and checking issuer, exact client audience/presenter, issued/expiry times and nonce. Client claims/roles never establish Google identity.

Scope is `openid profile`; the display name comes from the signed Google `name` claim, bounded to 80 characters. Missing/empty names use `Googleユーザー`. No userinfo endpoint or extra Google request is needed. Google email/profile photos/access/refresh/ID tokens are not stored. The database retains a hash of the Google subject. Content scripts never receive Google credentials or app bearer tokens. After verification, ordinary app tokens last at most 24 hours and session expiry remains authoritative. Signing out of Google elsewhere does not immediately revoke an already issued app session; **ログアウト** revokes the app token when the API is reachable. If offline, local credentials are cleared and server expiry still bounds the token.

The fixed login endpoints explicitly allow any Google-authenticated account into the operator-selected session/app. Google audience/test-user restrictions still apply. They do not grant access to other sessions. The server validates the configured app belongs to the session and the session is unexpired, then binds login to its current invite hash so changing it still invalidates an in-flight flow. The legacy invitation endpoints still validate the supplied invitation. Missing OAuth/destination configuration fails closed with 503. CORS and a hidden API URL are not an account allowlist; review this policy before future public hosting.

## Verification boundaries

`pnpm test` verifies signed test ID tokens and failure cases against real D1 in Workers, with all Google network requests mocked. Client tests exercise state/redirect/PKCE/cancellation handling. `pnpm test:browser` and `pnpm test:permissions` seed already-authenticated app participants in a temporary database and trusted extension storage; this is test setup, not a production login-bypass route/flag. They verify the review UI and permissions after authentication. Neither is evidence of a real Google login.

The real-account acceptance is: cancel once and remain unjoined; complete Google consent with no settings input, see the Google account name; see previous comments; post a comment; log out, see the login screen, verify the old app token no longer works, and log in again without losing comments. If Google rejects an automated test browser, use ordinary desktop Chrome with the unpacked extension and the registered ID; do not weaken Google's login protections. No screenshot of account/consent pages is required or captured.

Sources: [Google OpenID Connect server flow and token validation](https://developers.google.com/identity/openid-connect/openid-connect), [Google PKCE verifier/challenge guidance](https://developers.google.com/identity/protocols/oauth2/native-app), [Chrome Identity API and redirect URLs](https://developer.chrome.com/docs/extensions/reference/api/identity).

Windows Chrome login was confirmed by the user before the fixed-destination/profile update. The updated no-input login, account-name and logout/relogin flow remains a human acceptance check. Windows copies need an extension reload after rebuilding/copying `dist`; the manifest key keeps the registered redirect stable.
