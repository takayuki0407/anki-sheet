// Email/password login + sign-up for the web app (one account works on iOS + web). Apple/Google
// sign-in can be added later with account linking; email/password is the cross-platform common
// denominator with the iOS app.
import { useState } from "react";
import { useApp } from "../store/session";
import { resetPassword, signIn, signUp } from "../auth/useAuth";

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

  return (
    <div className="panel auth-panel">
      <div className="panel-head">
        <button className="btn ghost" onClick={() => setView({ name: "decks" })}>
          ← 戻る
        </button>
        <h2>{mode === "signin" ? "ログイン" : "アカウント作成"}</h2>
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
