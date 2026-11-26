import { useEffect, useState } from "react";
import { send, type SessionStatus } from "./protocol";
import { popupStyles } from "./ui-styles";
import { iconPaths, type IconName } from "./ui-icons";
function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {iconPaths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
export function Popup() {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function refresh() {
    setSession(await send<SessionStatus>({ type: "status" }));
  }
  useEffect(() => {
    void refresh().catch(() => {
      setSession({ joined: false });
      setError("拡張機能を開き直してください。");
    });
  }, []);
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "参加できませんでした。もう一度お試しください。",
      );
    } finally {
      setBusy(false);
    }
  }
  const activate = () =>
    action(async () => {
      await send({ type: "activate", mode: "view" });
      window.close();
    });
  return (
    <main>
      <style>{popupStyles}</style>
      <header className="brand">
        <span className="brand-mark">
          <Icon name="comment" />
        </span>
        <h1>App Feedback</h1>
      </header>
      {session === null ? (
        <div className="loading" role="status">
          <span className="spinner" aria-hidden="true" />
          読み込み中…
        </div>
      ) : session.joined ? (
        <>
          <div className="actions">
            <button
              className="open-action"
              aria-label="コメントを開く"
              disabled={busy}
              onClick={() => void activate()}
            >
              <span className="action-icon">
                <Icon name="comment" />
              </span>
              <span className="action-copy">
                <span className="action-label">コメントを開く</span>
                <span className="action-caption">このページで、見る・書く</span>
              </span>
              <Icon name="arrow" className="action-arrow" />
            </button>
          </div>
          <div
            className="account"
            role="status"
            aria-label={`${session.displayName} として参加中`}
          >
            <span className="avatar" aria-hidden="true">
              {Array.from(
                session.displayName.trim().split(/\s+/).at(-1) ?? "",
              )[0] ?? "?"}
            </span>
            <div className="account-copy">
              <span className="account-name">{session.displayName}</span>
              <span className="participation">
                <span className="presence" aria-hidden="true" />
                参加中
              </span>
            </div>
          </div>
          <div className="settings settings-actions">
            {session.active && (
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await send({ type: "disable" });
                    await refresh();
                  })
                }
              >
                このタブの表示をやめる
              </button>
            )}
            <button
              className="leave"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await send({ type: "forget" });
                  await refresh();
                })
              }
            >
              ログアウト
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="join-heading">
            <h2>ログインして、レビューを始める</h2>
            <p>Googleアカウント名で利用できます。</p>
          </div>
          <button
            className="join-submit"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await send({ type: "join" });
                await refresh();
              })
            }
          >
            {busy ? "ログイン中…" : "Googleでログイン"}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </main>
  );
}
