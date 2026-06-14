// Email/password login + sign-up for the web app (one account works on iOS + web). Apple/Google
// sign-in can be added later with account linking; email/password is the cross-platform common
// denominator with the iOS app.
import { useState } from "react";
import { useApp } from "../store/session";
import {
  resetPassword,
  signIn,
  signInWithApple,
  signInWithGoogle,
  signUp,
} from "../auth/useAuth";

/** Official Google "G" mark (inline SVG so it stays crisp without an asset). */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.59A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95L3.97 7.28C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

/** Apple logo mark (inline SVG, inherits color). */
function AppleIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 384 512" aria-hidden="true" fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function authError(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
  if (/invalid-credential|wrong-password|user-not-found/.test(code))
    return "メールアドレスまたはパスワードが正しくありません。";
  if (code.includes("email-already-in-use")) return "このメールアドレスは既に登録されています。";
  if (code.includes("weak-password")) return "パスワードは6文字以上にしてください。";
  if (code.includes("invalid-email")) return "メールアドレスの形式が正しくありません。";
  if (code.includes("too-many-requests"))
    return "試行回数が多すぎます。しばらくしてからお試しください。";
  if (code.includes("account-exists-with-different-credential"))
    return "このメールアドレスは別のログイン方法で登録済みです。";
  return err instanceof Error ? err.message : String(err);
}

export function Login() {
  const setView = useApp((s) => s.setView);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      if (mode === "signin") await signIn(email.trim(), pw);
      else await signUp(email.trim(), pw);
      setView({ name: "decks" });
    } catch (err) {
      setMsg(authError(err));
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    if (!email.trim()) {
      setMsg("先にメールアドレスを入力してください。");
      return;
    }
    try {
      await resetPassword(email.trim());
      setMsg("パスワード再設定メールを送信しました。");
    } catch (err) {
      setMsg(authError(err));
    }
  };

  const oauth = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setView({ name: "decks" });
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      // The user simply closing the popup isn't an error worth surfacing.
      if (!/popup-closed-by-user|cancelled-popup-request|user-cancelled|popup-blocked/.test(code)) {
        setMsg(authError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel auth-panel">
      <div className="panel-head">
        <button className="btn ghost" onClick={() => setView({ name: "decks" })}>
          ← 戻る
        </button>
        <h2>{mode === "signin" ? "ログイン" : "アカウント作成"}</h2>
      </div>
      <div className="oauth-buttons">
        <button
          type="button"
          className="oauth-btn apple"
          onClick={() => oauth(signInWithApple)}
          disabled={busy}
        >
          <AppleIcon />
          Appleでサインイン
        </button>
        <button
          type="button"
          className="oauth-btn google"
          onClick={() => oauth(signInWithGoogle)}
          disabled={busy}
        >
          <GoogleIcon />
          Googleでログイン
        </button>
      </div>
      <div className="oauth-divider">
        <span>または メールで</span>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          メールアドレス
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label className="field">
          パスワード
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={6}
            required
          />
        </label>
        {msg && <p className="auth-msg">{msg}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "処理中…" : mode === "signin" ? "ログイン" : "作成する"}
        </button>
      </form>
      <div className="auth-links">
        {mode === "signin" ? (
          <>
            <button className="linklike" onClick={() => (setMode("signup"), setMsg(""))}>
              アカウントを作成
            </button>
            <button className="linklike" onClick={onReset}>
              パスワードを忘れた場合
            </button>
          </>
        ) : (
          <button className="linklike" onClick={() => (setMode("signin"), setMsg(""))}>
            ログインに戻る
          </button>
        )}
      </div>
      <p className="muted small">
        1つのアカウントで iOSアプリ と Web の両方にログインできます（Proでクラウド同期）。
      </p>
    </div>
  );
}
