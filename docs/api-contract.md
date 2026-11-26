# API contract — milestone 1

JSON requests/responses. Prefix `/v1`, except health. Authenticated endpoints require `Authorization: Bearer <opaque participant token>`. Google login is mandatory. Invite codes are accepted only in Google-login start bodies; admin secrets authenticate no endpoint in this milestone. No client role fields are accepted.

## Routes

- `GET /health` → 200 `{"status":"ok"}`.
- `POST /v1/auth/google/start`, body `{"redirectUri":"https://<allowed-extension-id>.chromiumapp.org/google","codeChallenge":"<S256 base64url>"}` → 201 `{flowId, authorizationUrl}`. Server-only `DEFAULT_SESSION_ID` / `DEFAULT_APP_ID` choose one unexpired session and an app belonging to it. No invite, nickname or client destination fields are accepted. This endpoint allows any verified Google account into that configured destination; it does not enforce an account allowlist. Requests `openid profile`.
- `POST /v1/auth/google/join`, same completion body as the legacy `/sessions/:id/join` below → 201 `{participantId,token,expiresAt,authProvider:"google",displayName,sessionId,appId}`. Uses only the server destination, verifies Google/state/PKCE and rechecks session expiry/current invite hash. Display name is the signed Google account name (max 80 characters; missing/empty becomes `Googleユーザー`). Name is display data, never identity/authorization. Missing/invalid destination configuration fails closed with 503.
- `POST /v1/sessions/:sessionId/google/start`, body `{"inviteCode":"...","displayName":"...","redirectUri":"https://<allowed-extension-id>.chromiumapp.org/google","codeChallenge":"<S256 base64url>"}` → 201 `{"flowId":"uuid","authorizationUrl":"https://accounts.google.com/o/oauth2/v2/auth?..."}`. Validates the invitation/session and exact registered extension redirect; creates a five-minute, one-use flow with hashed state/nonce/invite and a PKCE challenge. Requests Google `openid profile`. Invitation 1–256 characters; legacy nickname input 1–80 after trimming, retained for compatibility but ignored when creating the participant.
- `POST /v1/sessions/:sessionId/join`, body `{"flowId":"uuid","state":"<64 hex>","code":"<Google authorization code>","codeVerifier":"<43–128 unreserved characters>"}` → 201 `{"participantId":"uuid","token":"<64 hex>","expiresAt":"UTC ISO","authProvider":"google","displayName":"Google Account Name"}`. Atomically consumes the unexpired flow only for matching session/state/PKCE, exchanges the code at Google's fixed token endpoint, and checks the ID token's RS256 signature, issuer, exact client audience/presenter, expiry/issued time and nonce with Google's fixed JWKS endpoint. Rechecks the still-valid invite/session before creating a participant with hashed Google subject. App token: 256 random bits, SHA-256 hashed, expiry min(24 hours, session expiry). Invite-only join is rejected; Google access/refresh/ID tokens are not persisted or returned to the extension.
- `POST /v1/participants/logout`, authenticated, body `{}` → 200 `{"status":"ok"}`. Expires and rotates the current app token hash, preserving feedback. This is app logout, not Google website logout.
- `GET /v1/apps/:appId/feedback?path=/app/settings&pageUrl=https%3A%2F%2Fdemo.example%2Fapp%2Fsettings` → 200 `{"items":[{"id":"uuid","target":{...},"category":"suggestion","comment":"...","createdAt":"UTC ISO"}]}`. Requires membership in the app's session and unexpired session/participant. **Both `path` and `pageUrl` are required.** Registered origin, base path and the supplied path must agree. Returns only the exact normalized route, latest 500 in chronological order; no participant tokens, author IDs or display names in results.
- `POST /v1/apps/:appId/feedback` → 201 `{"id":"uuid","createdAt":"UTC ISO"}`. Same membership and page checks. Body:

```json
{
  "pageUrl": "https://demo.example/app/settings",
  "target": {
    "selector": "html > body:nth-of-type(1) > button:nth-of-type(1)",
    "tagName": "BUTTON",
    "textSnippet": "保存する",
    "rect": { "x": 0.6, "y": 0.25, "width": 0.1, "height": 0.05 }
  },
  "category": "suggestion",
  "comment": "もう少し目立たせたい"
}
```

## Validation and isolation

HTTP(S) URLs only, no URL credentials. URL and path ≤2048 characters, total request URL ≤8192. Query and hash do not identify routes or reach storage. Trailing slashes collapse; URL dot segments normalize. Encoded slash/backslash paths and paths starting `//` are rejected. Base path `/app` includes `/app` and `/app/...`, not `/application`. Membership is required regardless of CORS or claimed page URL. Cross-session and unknown app IDs both return 404; invalid/expired bearer credentials return a generic 401. Session expiry also invalidates existing participants. A non-null server-verified Google-subject hash is required on every authenticated request; pre-migration anonymous tokens are rejected. App bearer tokens are not Google tokens.

POST requires media type `application/json` and a valid UTF-8 JSON body ≤16 KiB, measured from the stream, independent of Content-Length. Zod objects are strict; unknown fields (including roles, HTML, input values or extra rect fields) are rejected. Comment 1–2000 characters after trimming; category `bug | suggestion | praise`. Tag 1–50 uppercase alphanumeric/hyphen characters, excluding form controls, SCRIPT, STYLE and IFRAME. Snippet ≤120 characters, extracted by the extension from direct text nodes only, with no form values/descendant HTML. Rect values must be finite numbers in [0,1], relative to viewport width/height at capture time, clipped at viewport bounds.

Selectors ≤512 characters, limited to `html > tag:nth-of-type(N)` chains (1–40 steps, N 1–999999); no attribute values or identifiers. This deliberately narrows the draft's arbitrary CSS selector example to avoid persisting sensitive attributes. DOM resolution still treats stored metadata as untrusted and verifies uniqueness, safe eligibility, tag and captured text. Comments are always rendered with text nodes. The Worker never fetches `pageUrl`.

GET adds `pageUrl` to the draft contract so reads can validate registered origin as well as path. This is an identifier check, not a server-side browser attestation. The extension checks the actual message sender's origin/path and accepts only top-frame messages from its own extension before sending a sanitized URL to the API.

## Transport and abuse controls

`EXTENSION_ORIGINS` is a comma-separated exact allowlist of `chrome-extension://<32 a–p letters>` origins, empty by default. No wildcard, reflected arbitrary origin or credentials CORS. Requests with a non-allowlisted Origin (including `null`) receive 403. Preflight accepts only GET/POST with Authorization/Content-Type. No-Origin programmatic requests still require the same authorization. Responses use `Cache-Control: no-store` and `Vary: Origin`.

D1 fixed-window counters: Google-login starts and join completions each 10/IP/minute and 60/session/minute, authenticated feedback traffic 120/participant/minute, with `Retry-After: 60` on 429. Bucket identities are hashed and expire after at most two minutes; expired rows are removed on subsequent limited requests. This is small-group abuse control, not DDoS protection. A future Cloudflare deployment must preserve trusted CF-Connecting-IP semantics.

Error shape: `{"error":{"code":"VALIDATION_ERROR","message":"..."}}`; statuses 400 (validation/JSON), 401 (credentials), 403 (CORS/page), 404 (resource), 413 (body limit), 429 (rate limit), 500 (generic failure), 503 (`AUTH_NOT_CONFIGURED` when OAuth settings are absent). No stack, SQL or auth detail is returned. All SQL parameters are bound.
