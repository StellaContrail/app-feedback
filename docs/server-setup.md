# Cloudflare Workers + D1 サーバ運用

本番 API は利用者の承認を受けて公開済みです。以下は現在の構成と再構築の手順です。拡張機能の公開は不要で、ビルド済みの `dist` を各自の Chrome に読み込めます。レビュー対象のアプリは別途稼働している必要があります。

## 現在の公開状態（2026-11-29）

- API: https://api.example.com
- Worker: `app-feedback`
- D1: `app-feedback-production`（APAC）。0001–0004 の全マイグレーション適用済み。
- Google OAuth の2つの値は Worker secrets に登録済み。秘密値はソース・拡張機能に含めません。
- 公開 URL で health 200、未認証 feedback 401、通常サイト Origin 403、拡張 preflight 204、Google ログイン開始 201 を確認済み。ログイン開始は D1 のフロー書込みを含みます。
- 実アカウントでの Google 同意・トークン発行・本番コメント投稿は未確認です。次の受入確認は、各自の Chrome でログインし、2つのアカウントで同じページの投稿・ピンを共有することです。

本番接続用の拡張機能は 0.1.4（投稿者名、3択の種類選択、種類別のピン色、ログイン後の拡張機能への GitHub フィードバック）です。API の投稿者名取得も反映済みで、DB マイグレーション追加は不要です。

本番接続用にビルドした `apps/extension/dist`、および `.local/releases/app-feedback-extension.zip` を用意しています。ZIP を展開したフォルダを `chrome://extensions` の「パッケージ化されていない拡張機能を読み込む」で指定してください。通常の `pnpm build` はローカル接続用に戻すため、サーバ用は下記の `APP_FEEDBACK_API_ORIGIN` 付きでビルドしてください。

## 承認前にできる確認

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`apps/api/wrangler.production.jsonc` は現在の本番 D1 ID を設定した独立設定です。別アカウントに構築する場合は、そのアカウントで作成した D1 ID に置き換えてください。ローカル設定と既存データは引き続きローカル用です。

## 承認後の初回構築

以下の Wrangler コマンドは `apps/api` で実行します。認証情報はチャットに貼らず、ローカルの対話プロンプトに入力してください。

1. `pnpm exec wrangler login` で利用する Cloudflare アカウントにログインします。
2. `pnpm exec wrangler d1 create app-feedback-production` で D1 を作成し、返された ID を `wrangler.production.jsonc` の `database_id` に設定します。
3. `pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc` で本番 D1 にスキーマを作成します。
4. Google OAuth 用の以下の値を、それぞれ `pnpm exec wrangler secret put <名前> --config wrangler.production.jsonc` で設定します。

   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

   レビュー対象 URL の事前登録、bootstrap SQL、`DEFAULT_SESSION_ID`、`DEFAULT_APP_ID` は不要です。サイトは最初の投稿時に自動作成されます。旧設定が残っていても、新しいサイト共有フローでは参照しません。

5. Google OAuth クライアントに `https://ijagaijpoccamffckkbfppnilhpblekc.chromiumapp.org/google` を登録します。[Google 設定](google-login.md)も参照してください。公開 API では、Google 認証に成功した全利用者が同じ origin・パスのコメントを読み書きできます。これは利用者が選択した共有方式です。Google 側の audience・テストユーザー制限は引き続き適用されます。CORS はアカウント制限ではありません。
6. `pnpm exec wrangler deploy --config wrangler.production.jsonc` で公開します。表示された HTTPS URL の `/health` が `{"status":"ok"}` を返すことを確認します。これは D1 や OAuth の動作確認ではありません。

## サーバに接続する拡張機能

リポジトリのルートで、実際の Worker URL を指定します。

```sh
APP_FEEDBACK_API_ORIGIN=https://api.example.com pnpm --filter @app-feedback/extension build
```

この変数は公開 API の origin だけです。秘密情報を設定しないでください。HTTPS の origin のみ受け付け、パス、クエリ、認証情報は拒否します。生成した manifest は、その API のホスト権限だけを持ちます。レビュー対象サイトは引き続き activeTab によるユーザー操作で許可します。設定を省略すると従来のローカルビルドになります。

各 Chrome で `apps/extension/dist` を読み込み直し、Google ログインを行います。API を変更した場合は再ログインが必要です。manifest の key を維持するため拡張 ID と Google リダイレクト URI は変わりません。別の ID を使う場合はサーバの `EXTENSION_ORIGINS` と Google 側の URI を明示的に追加してください。

## 稼働確認と制約

2つの Chrome プロファイルでログインし、同じページで A が投稿、B が再読み込みしてピンを確認します。他 origin・別 route では見えないことと、ログアウト後の再ログインも確認してください。実際の Google ログインと公開環境の疎通は自動テストでは確認されません。

削除・管理画面、スクリーンショットは範囲外です。サイトに期限はありませんが、ログイントークンは24時間で期限切れとなり、再ログインが必要です。旧セッション内のコメントは共有テーブルへ移行しません。Cloudflare の利用料金・制限はアカウントのプランに従います。秘密情報、招待コード、参加トークンをログやリポジトリに残さないでください。

公式資料: [Wrangler 設定](https://developers.cloudflare.com/workers/wrangler/configuration/)、[D1 コマンド](https://developers.cloudflare.com/workers/wrangler/commands/d1/)、[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。本リポジトリは Wrangler 4.35.0 を固定して使用します。
