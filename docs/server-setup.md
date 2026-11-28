# Cloudflare Workers + D1 サーバ運用

本番固有の接続先と識別子はコミットしません。拡張機能はビルド済みの `dist` を各自の Chrome に読み込めます。レビュー対象のアプリは別途稼働している必要があります。

## 承認前にできる確認

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`apps/api/wrangler.production.example.jsonc` は本番設定のひな形です。`apps/api/wrangler.private.jsonc` にコピーし、D1 ID と `EXTENSION_ORIGINS` を設定します。コピー先は Git 管理外です。ひな形のゼロ埋め D1 ID は実環境では使えません。既存環境では設定ファイルを上書きしないでください。

## 承認後の初回構築

以下の Wrangler コマンドは `apps/api` で実行します。認証情報はチャットに貼らず、ローカルの対話プロンプトに入力してください。

1. `pnpm exec wrangler login` で利用する Cloudflare アカウントにログインします。
2. `pnpm exec wrangler d1 create app-feedback-production` で D1 を作成し、返された ID を `wrangler.private.jsonc` の `database_id` に設定します。
3. `pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.private.jsonc` で本番 D1 にスキーマを作成します。
4. Google OAuth 用の以下の値を、それぞれ `pnpm exec wrangler secret put <名前> --config wrangler.private.jsonc` で設定します。

   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

   レビュー対象 URL の事前登録、bootstrap SQL、`DEFAULT_SESSION_ID`、`DEFAULT_APP_ID` は不要です。サイトは最初の投稿時に自動作成されます。旧設定が残っていても、新しいサイト共有フローでは参照しません。

5. Google OAuth クライアントに `https://<extension-id>.chromiumapp.org/google` を登録し、対応する `chrome-extension://<extension-id>` を `EXTENSION_ORIGINS` に設定します。[Google 設定](google-login.md)も参照してください。公開 API では、Google 認証に成功した全利用者が同じオリジン・パスのコメントを読み書きできます。Google 側の対象ユーザー・テストユーザー制限は引き続き適用されます。CORS はアカウント制限ではありません。
6. `pnpm exec wrangler deploy --config wrangler.private.jsonc` で公開します。表示された HTTPS URL の `/health` が `{"status":"ok"}` を返すことを確認します。これは D1 や OAuth の動作確認ではありません。

## サーバに接続する拡張機能

リポジトリのルートで、例示の URL を実際の Worker URL に置き換えて実行します。接続先は生成物に含まれるため、配布した拡張機能の利用者からは確認できます。

```sh
APP_FEEDBACK_API_ORIGIN=https://api.example.com pnpm --filter @app-feedback/extension build
```

この変数は公開 API のオリジンだけです。秘密情報を設定しないでください。HTTPS のオリジンのみ受け付け、パス、クエリ、認証情報は拒否します。生成した manifest は、その API のホスト権限だけを持ちます。レビュー対象サイトは引き続き activeTab によるユーザー操作で許可します。設定を省略すると従来のローカルビルドになります。

各 Chrome で `apps/extension/dist` を読み込み直し、Google ログインを行います。API を変更した場合は再ログインが必要です。manifest の key を維持するため拡張 ID と Google リダイレクト URI は変わりません。別の ID を使う場合はサーバの `EXTENSION_ORIGINS` と Google 側の URI を明示的に追加してください。

## 稼働確認と制約

2つの Chrome プロファイルでログインし、同じページで A が投稿、B が再読み込みしてピンを確認します。別オリジン・別ルートでは見えないことと、ログアウト後の再ログインも確認してください。実際の Google ログインと公開環境の疎通は自動テストでは確認されません。

削除・管理画面、スクリーンショットは範囲外です。サイトに期限はありませんが、ログイントークンは24時間で期限切れとなり、再ログインが必要です。旧セッション内のコメントは共有テーブルへ移行しません。Cloudflare の利用料金・制限はアカウントのプランに従います。秘密情報、招待コード、参加トークンをログやリポジトリに残さないでください。

公式資料: [Wrangler 設定](https://developers.cloudflare.com/workers/wrangler/configuration/)、[D1 コマンド](https://developers.cloudflare.com/workers/wrangler/commands/d1/)、[Worker のシークレット](https://developers.cloudflare.com/workers/configuration/secrets/)。Wrangler とテストプールのバージョンは、互換性を確認した組み合わせで固定します。
