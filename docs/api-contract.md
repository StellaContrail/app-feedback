# API 契約 — マイルストーン1

リクエスト・レスポンスは JSON です。ヘルスチェックを除き、接頭辞は `/v1` です。認証対象のエンドポイントは `Authorization: Bearer <opaque participant token>` を必須とし、Google ログインが必要です。招待コードを受け付けるのは、旧セッション用 Google ログイン開始の本文だけです。管理者シークレットで認証できるエンドポイントは、このマイルストーンにはありません。クライアントからのロール指定は受け付けません。

## ルート

- `GET /health` → 200 `{"status":"ok"}`。
- `POST /v1/auth/google/start`、本文 `{"redirectUri":"https://<allowed-extension-id>.chromiumapp.org/google","codeChallenge":"<S256 base64url>"}` → 201 `{flowId, authorizationUrl}`。サイト・セッションとは独立して Google アカウントを認証します。招待、ニックネーム、遷移先、ロールのフィールドは受け付けません。許可済みリダイレクト、ハッシュ化した state・nonce、PKCE challenge に紐付く、有効期間5分・1回限りのフローを作成します。`openid profile` を要求します。
- `POST /v1/auth/google/join`、本文 `{"flowId":"uuid","state":"<64 hex>","code":"<Google authorization code>","codeVerifier":"<43–128 unreserved characters>"}` → 201 `{participantId,token,expiresAt,authProvider:"google",scope:"sites",displayName}`。後述と同じ署名・発行者・audience・有効期限・nonce の検証で Google・state・PKCE を確認します。トークンは256ランダムビットで、保存時はハッシュ化し、24時間で失効します。セッションやアプリの遷移先は返しません。署名された Google 名は80文字までに制限し、存在しない・空白の場合は `Googleユーザー` とします。
- `POST /v1/auth/logout`、サイトトークンで認証、本文 `{}` → 200 `{"status":"ok"}`。コメントを削除せず、トークンを失効させてハッシュを更新します。
- `GET /v1/sites/feedback?pageUrl=https%3A%2F%2Fdemo.example%2Fapp%2Fsettings` → 200 `{"items":[{"id":"uuid","target":{...},"category":"suggestion","comment":"...","createdAt":"UTC ISO","authorName":"Google Account Name"}]}`。有効なサイト共有用 Google トークンが必要です。投稿者名はサーバー検証済みの参加者レコードから取得し、ログアウト後も参照でき、コメントクライアントからは指定できません。メール、Google subject、投稿者 ID、Bearer トークンは返しません。導出したオリジンと正規化パスが完全一致する最新500件を時系列順で返します。未知のページではサイトを作成せず空の一覧を返します。重複クエリパラメーターと未知のクエリフィールドは拒否します。独立したクライアント指定の `siteId`、`path`、セッション、ロールは受け付けません。
- `POST /v1/sites/feedback`、サイトトークンで認証 → 201 `{"id":"uuid","createdAt":"UTC ISO"}`。後述のフィードバック本文を使用します。初回投稿時に、導出したオリジンに対する一意のサイトをアトミックに作成し、正規化パスにコメントを保存します。ログイン済みの全ユーザーが全サイトで読み書きでき、API はレビュー対象サイトの所有権やアクセス権を検証しません。HTTP・HTTPS、サブドメイン、非既定ポートは別サイトを識別します。

## 旧プライベートセッションのルート

互換性のためだけに残すルートで、更新後の拡張機能では使用しません。旧トークンで `/sites/*` や `/auth/logout` を認可できず、サイトトークンでも旧アプリのエンドポイントを認可できません。マイグレーション0004は空の共有テーブルを作成し、旧コメントを全ユーザーに自動公開しません。旧 bootstrap スクリプトはサイト共有には不要です。`DEFAULT_SESSION_ID` と `DEFAULT_APP_ID` は使用しません。

- `POST /v1/sessions/:sessionId/google/start`、本文 `{"inviteCode":"...","displayName":"...","redirectUri":"https://<allowed-extension-id>.chromiumapp.org/google","codeChallenge":"<S256 base64url>"}` → 201 `{"flowId":"uuid","authorizationUrl":"https://accounts.google.com/o/oauth2/v2/auth?..."}`。招待・セッションと登録済み拡張機能リダイレクトの完全一致を検証し、ハッシュ化した state・nonce・招待と PKCE challenge を持つ、有効期間5分・1回限りのフローを作成します。Google の `openid profile` を要求します。招待は1〜256文字です。旧ニックネーム入力は前後の空白除去後1〜80文字で、互換性のために残しますが参加者作成時は無視します。
- `POST /v1/sessions/:sessionId/join`、本文 `{"flowId":"uuid","state":"<64 hex>","code":"<Google authorization code>","codeVerifier":"<43–128 unreserved characters>"}` → 201 `{"participantId":"uuid","token":"<64 hex>","expiresAt":"UTC ISO","authProvider":"google","displayName":"Google Account Name"}`。セッション・state・PKCE が一致する未失効フローだけをアトミックに消費し、Google の固定トークンエンドポイントでコードを交換します。固定 JWKS エンドポイントを使い、ID トークンの RS256 署名、発行者、クライアントの audience・presenter の完全一致、有効期限・発行時刻、nonce を確認します。招待・セッションが引き続き有効であることを再確認してから、Google subject をハッシュ化した参加者を作成します。アプリトークンは256ランダムビット、SHA-256 ハッシュ保存で、有効期限は24時間とセッション期限の早い方です。招待だけの参加は拒否します。Google のアクセス・リフレッシュ・ID トークンは永続化せず、拡張機能にも返しません。
- `POST /v1/participants/logout`、認証必須、本文 `{}` → 200 `{"status":"ok"}`。フィードバックを保持したまま、現在のアプリトークンを失効させてハッシュを更新します。アプリからのログアウトであり、Google サイトからのログアウトではありません。
- `GET /v1/apps/:appId/feedback?path=/app/settings&pageUrl=https%3A%2F%2Fdemo.example%2Fapp%2Fsettings` → 200 `{"items":[{"id":"uuid","target":{...},"category":"suggestion","comment":"...","createdAt":"UTC ISO"}]}`。アプリのセッションへの所属と、セッション・参加者の有効期限内であることが必要です。**`path` と `pageUrl` の両方が必須です。** 登録済みオリジン、ベースパス、指定パスが一致する必要があります。正規化ルートが完全一致する最新500件だけを時系列順で返し、参加者トークン、投稿者 ID、表示名は含めません。
- `POST /v1/apps/:appId/feedback` → 201 `{"id":"uuid","createdAt":"UTC ISO"}`。同じ旧所属・ページ検証を行います。新旧のフィードバックエンドポイントは共通して次の本文を使用します。

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

## 検証と分離

HTTP(S) URL のみを許可し、URL 内の認証情報は許可しません。URL とパスは2048文字以下、リクエスト URL 全体は8192文字以下です。クエリとハッシュはルート識別に使わず、保存もしません。末尾のスラッシュをまとめ、URL のドットセグメントを正規化します。エンコードされたスラッシュ・バックスラッシュを含むパスと、`//` で始まるパスは拒否します。サイト共有では CORS にかかわらず、全読み書きに Google 認証で発行した有効なサイトトークンが必要です。オリジンとルートは検証済み URL からサーバー側で導出します。認証済みの全ユーザーがそのページのコメントを共有し、サイト所属や所有権による制限はありません。無効・期限切れトークンには汎用的な401を返します。旧エンドポイントに限り、セッション期限、登録済みオリジン・ベースパス、所属の検証を継続します。アプリの Bearer トークンは Google トークンとは別物です。

POST にはメディアタイプ `application/json` と有効な UTF-8 JSON 本文が必要です。本文は Content-Length に頼らずストリームで計測して16 KiB 以下とします。Zod オブジェクトは strict とし、未知のフィールド（ロール、HTML、入力値、rect の追加フィールドなど）を拒否します。コメントは前後の空白除去後1〜2000文字、種類は `bug | suggestion | praise` です。タグは大文字英数字・ハイフンの1〜50文字で、フォームコントロール、SCRIPT、STYLE、IFRAME を除外します。抜粋は120文字以下で、拡張機能が直接のテキストノードだけから抽出し、フォーム値や子孫 HTML を含めません。矩形の値は [0,1] の有限数で、取得時のビューポート幅・高さに対する比率とし、ビューポートの境界で切り詰めます。

セレクターは512文字以下で、`html > tag:nth-of-type(N)` の連鎖に限定します（1〜40段、N は1〜999999）。属性値や識別子は含めません。機密属性の保存を避けるため、草案の任意 CSS セレクター例から意図的に制限しています。DOM の解決時も保存済みメタデータを信頼せず、一意性、安全な選択対象であること、タグ、取得済みテキストを検証します。コメントは常にテキストノードで表示します。Worker は `pageUrl` を取得しません。

ページ URL は識別子であり、ブラウザーの証明やサイトへのアクセス権の証明ではありません。拡張機能は実際のメッセージ送信元のオリジン・パスを確認し、自身の拡張機能からのトップフレームメッセージだけを受け付けて、不要な情報を除いた URL を送信します。新しいサイトは登録不要で、空ページの読み取りでは閲覧履歴を保存しません。

## 通信と不正利用対策

`EXTENSION_ORIGINS` は `chrome-extension://<32 a–p letters>` オリジンをカンマ区切りで列挙する完全一致の許可リストで、既定は空です。ワイルドカード、任意オリジンの反映、認証情報付き CORS は使用しません。許可リスト外の Origin（`null` を含む）付きリクエストは403になります。プリフライトは GET/POST と Authorization/Content-Type のみ許可します。Origin のないプログラムからのリクエストにも同じ認可が必要です。レスポンスに `Cache-Control: no-store` と `Vary: Origin` を設定します。

D1 の固定時間窓カウンター: サイトの Google ログイン開始と完了はそれぞれ10回/IP/分（別枠）、旧ログインにはさらに60回/セッション/分、認証済みフィードバック通信には120回/参加者/分を適用し、429には `Retry-After: 60` を返します。バケット識別子はハッシュ化し、最大2分で失効させ、その後の制限対象リクエストで期限切れ行を削除します。少人数向けの不正利用対策であり、DDoS 対策ではありません。今後の Cloudflare デプロイでも、信頼できる CF-Connecting-IP の扱いを維持する必要があります。

エラー形式: `{"error":{"code":"VALIDATION_ERROR","message":"..."}}`。ステータスは400（検証・JSON）、401（認証情報）、403（CORS・ページ）、404（リソース）、413（本文サイズ）、429（レート制限）、500（汎用的な障害）、503（OAuth 設定がない場合の `AUTH_NOT_CONFIGURED`）です。スタック、SQL、認証の詳細は返しません。全 SQL パラメーターをバインドします。
