# API contract draft — milestone 1

JSON requests/responses. Prefix `/v1`, except health. Authenticated endpoints use `Authorization: Bearer <opaque participant token>`. Invite code is only submitted in join body.

- `GET /health` -> 200 `{"status":"ok"}`
- `POST /v1/sessions/:sessionId/join` body `{"inviteCode":"...","displayName":"..."}` -> 201 `{"participantId":"uuid","token":"...","expiresAt":"ISO"}`; rate-limit join.
- `GET /v1/apps/:appId/feedback?path=/settings` -> 200 `{"items":[...]}`; require session membership; exact normalized path.
- `POST /v1/apps/:appId/feedback` -> 201 `{"id":"uuid","createdAt":"ISO"}`, body:

```json
{
  "pageUrl": "https://demo.example/settings",
  "target": {
    "selector": "button[data-testid=save]",
    "tagName": "BUTTON",
    "textSnippet": "保存する",
    "rect": {"x": 0.6, "y": 0.25, "width": 0.1, "height": 0.05}
  },
  "category": "suggestion",
  "comment": "もう少し目立たせたい"
}
```

Verify registered origin/path on POST, require membership on GET, reject password/secret metadata, bound strings and payload. Selector is untrusted metadata and must be resolved defensively only in the extension.

Error shape: `{"error":{"code":"VALIDATION_ERROR","message":"..."}}` with appropriate HTTP 400/401/403/404/413/429/500. Avoid auth detail leaks.
