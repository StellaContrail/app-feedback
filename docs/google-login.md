# Google ログインの設定と受入確認

Google アカウントが必要です。ポップアップで一度ログインすれば、招待、セッション・アプリ ID、ニックネーム、固定の遷移先なしで任意の HTTP(S) サイトを利用できます。認証済みの全ユーザーが、完全一致するオリジンと正規化パスごとにフィードバックを共有します。これはユーザーが選択した共有方針です。API はレビュー対象サイトのアカウントに対する利用者のアクセス権を検証しません。

## Google とローカル API の設定

1. [Google Auth Platform](https://console.cloud.google.com/auth/clients) でプロジェクトを選択・作成し、ブランディングと対象ユーザーを設定します。テストモードでは、テストに使用する Google アカウントを追加します。
2. 種類が **ウェブ アプリケーション（Web application）** の OAuth クライアントを作成します。認可コードの交換はサーバーが行うため、シークレットを拡張機能とともに配布してはいけません。
3. `apps/extension/dist` をパッケージ化されていない拡張機能として読み込み、拡張 ID を確認します。クライアントの承認済みリダイレクト URI に `https://<extension-id>.chromiumapp.org/google` を正確に登録します。コミット済み manifest の公開鍵により、Windows にビルドをコピーした場合も開発用 ID は `ijagaijpoccamffckkbfppnilhpblekc` に固定されます。`https://ijagaijpoccamffckkbfppnilhpblekc.chromiumapp.org/google` を登録し、`EXTENSION_ORIGINS` で `chrome-extension://ijagaijpoccamffckkbfppnilhpblekc` を許可します。公開鍵は OAuth シークレットではありません。`.dev.vars` を変更したらローカル API を再起動します。
4. `apps/api/.dev.vars` に次を追加します。`EXTENSION_ORIGINS` の完全一致の許可リストは維持します。

   ```dotenv
   GOOGLE_CLIENT_ID="<web-application-client-id>.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="<server-only-secret>"
   ```

   シークレットをチャットに貼ったり、コミットしたりしないでください。本番設定には Worker secrets を使用する必要があります。この手順は本番デプロイを承認するものではありません。

5. `.dev.vars` の編集後はローカル API を再起動し、新しい OAuth 設定を読み込ませます。変更前から動いている API は `AUTH_NOT_CONFIGURED` を返し続ける場合があります。`pnpm --filter @app-feedback/api migrate` を実行して拡張機能をビルドし、再起動・再読み込みで新しい `identity` 権限とログインコードを反映します。README に従いローカル API を起動します。旧セッションの参加者トークンではサイト共有を認可できないため、再ログインしてください。保存済みのプライベートセッションのコメントは旧テーブルに残り、新しい共有テーブルへ自動公開されません。初期データ生成や `DEFAULT_SESSION_ID` / `DEFAULT_APP_ID` の設定は不要です。
6. **Googleでログイン** を押し、自分でアカウント選択・同意を完了します。Google のパスワードや二要素認証は Google 自身のページだけで入力します。ログイン後は **コメントを開く** から通常のレビュー操作に進めます。

## セキュリティとプライバシー

拡張機能はメモリ内で256ビットの PKCE verifier を生成し、`chrome.identity.getRedirectURL('google')` / `launchWebAuthFlow` を使用します。サーバーの5分間のフローが、許可済みリダイレクト、state、nonce、S256 challenge をサイト・セッションとは独立に紐付けます。state と nonce はハッシュ化して保存します。返されたコードを API に送る前に、コールバックのオリジン・パス、state、重複パラメーターを検証します。フローはアトミックに消費し、再利用を防ぎます。

コードを交換するのは API のみで、固定の Google トークンエンドポイントとサーバー専用クライアントシークレットを使います。そのシークレットを伴うリクエストではリダイレクトを追跡しません。`jose` が Google の固定公開鍵エンドポイントで ID トークンを検証します。RS256 だけを許可し、発行者、クライアントの audience・presenter の完全一致、発行・有効期限、nonce を確認します。クライアントの申告やロールで Google の本人確認を成立させません。

スコープは `openid profile` です。表示名は署名された Google の `name` クレームに基づき、80文字までに制限します。名前がない・空の場合は `Googleユーザー` とします。userinfo エンドポイントや Google への追加リクエストは不要です。Google のメールアドレス、プロフィール写真、アクセス・リフレッシュ・ID トークンは保存しません。データベースには Google subject のハッシュを保持します。コンテンツスクリプトに Google 認証情報やアプリの Bearer トークンを渡しません。検証後に発行するサイト共有用アプリトークンの有効期間は24時間です。サイトデータにはイベント・セッションの期限がありません。別の場所で Google からログアウトしても、発行済みアプリセッションは直ちには失効しません。**ログアウト** は API に接続できる場合にアプリトークンを失効させます。オフラインの場合はローカル認証情報を消去し、サーバー側では通常の有効期限が適用されます。

サイトのログインエンドポイントは、Google 認証済みの任意のアカウントによる任意サイトのレビューを明示的に許可します。Google 側の対象ユーザー・テストユーザー制限は引き続き適用されます。OAuth 設定がない場合は503でアクセスを拒否します。CORS や API URL の非公開化はアカウントの許可リストにはなりません。サーバーは検証済み URL からオリジンと正規化ルートを導出し、クライアントが申告するサイト ID、ロール、所有権で追加権限を与えません。ログイン時、拡張機能はレビュー対象のページ URL を送信しません。旧招待エンドポイントは従来のプライベートセッション用に分離して残し、そのトークンも旧コメントもサイト共有には持ち込みません。

## 検証の範囲

`pnpm test` は Google への全通信をモックし、署名付きテスト ID トークンと異常系を Workers 内の実 D1 で検証します。クライアントのテストは state・リダイレクト・PKCE・キャンセル処理を検証します。`pnpm test:browser` と `pnpm test:permissions` は、認証済みアプリ参加者を一時データベースと信頼済み拡張機能ストレージに投入します。これはテスト準備であり、本番のログイン回避ルート・フラグではありません。認証後のレビュー UI と権限を検証しますが、実際の Google ログインの証拠にはなりません。

実アカウントでの受入確認: 一度キャンセルして未参加のままであること、設定入力なしで Google 同意を完了してアカウント名が表示されること、既存コメントを閲覧できること、コメントを投稿できること、ログアウトしてログイン画面に戻ること、旧アプリトークンが無効になること、再ログインしてもコメントが失われないことを確認します。Google が自動テスト用ブラウザーを拒否する場合は、登録済み ID のパッケージ化されていない拡張機能を通常のデスクトップ版 Chrome で使用してください。Google のログイン保護を弱めないでください。アカウント・同意画面のスクリーンショットは不要で、取得もしません。

参考資料: [Google OpenID Connect のサーバーフローとトークン検証](https://developers.google.com/identity/openid-connect/openid-connect)、[Google の PKCE verifier・challenge の説明](https://developers.google.com/identity/protocols/oauth2/native-app)、[Chrome Identity API とリダイレクト URL](https://developer.chrome.com/docs/extensions/reference/api/identity)。

Windows へのコピーでは、`dist` の再ビルド・コピー後に拡張機能を再読み込みしてください。manifest の key により登録済みリダイレクトは維持されます。
