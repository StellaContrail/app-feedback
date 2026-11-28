import { useState } from "react";

// A fixed destination: user text can never choose a repository or URL.
export function extensionIssueUrl(text: string, version: string): string {
  const body = text.trim();
  if (!body || text.length > 500 || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version))
    throw new Error("フィードバックは1〜500文字で入力してください。");
  const title = Array.from(body.split(/\r?\n/, 1)[0]).slice(0, 80).join("");
  const url = new URL(
    "https://github.com/StellaContrail/app-feedback/issues/new",
  );
  url.search = new URLSearchParams({
    title: `[拡張機能] ${title}`,
    body: `## フィードバック\n\n${body}\n\n---\nApp Feedback バージョン: ${version}`,
  }).toString();
  return url.toString();
}

export function ExtensionFeedback() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <details className="extension-feedback">
      <summary>この拡張機能にフィードバック</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setError("");
          setBusy(true);
          void (async () => {
            try {
              const url = extensionIssueUrl(
                text,
                chrome.runtime.getManifest().version,
              );
              await chrome.tabs.create({ url });
            } catch {
              setError(
                "GitHubを開けませんでした。入力内容を確認して、もう一度お試しください。",
              );
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label htmlFor="extension-feedback-text">気づいたこと</label>
        <textarea
          id="extension-feedback-text"
          maxLength={500}
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="使いづらいところ、あると嬉しい機能など（500文字まで）"
        />
        <p>
          GitHubの作成画面で確認し、投稿できます。GitHubアカウントが必要で、投稿内容は公開されます。
        </p>
        <button type="submit" disabled={busy || !text.trim()}>
          GitHubで確認する
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
