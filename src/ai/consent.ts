// One-time opt-in for AI question generation. Unlike the rest of the app (detection / red sheet run
// entirely on-device), generation sends the page's text + marked terms to our server → Anthropic.
// We ask for explicit consent before the FIRST generation and remember it per browser.
const KEY = "aiConsent";

export function hasAiConsent(): boolean {
  return localStorage.getItem(KEY) === "1";
}

/** Returns true if generation may proceed: already consented, or the user accepts the prompt now. */
export function ensureAiConsent(): boolean {
  if (hasAiConsent()) return true;
  const ok = window.confirm(
    "AI問題生成について\n\n" +
      "この機能では、選んだページの本文と暗記語句を、当アプリのサーバー経由で AI（Anthropic）に" +
      "送信して問題を作成します。\n" +
      "赤シート・色の検出など他の機能は、これまでどおり端末内だけで完結します。\n\n" +
      "同意して続けますか？",
  );
  if (ok) localStorage.setItem(KEY, "1");
  return ok;
}
