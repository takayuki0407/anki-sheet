// Admin-only dev tool: switch the signed-in account's tier to exercise plan behavior (the Standard
// per-device limit, the forced-trim downgrade, Pro cloud sync, the 6-month retention) WITHOUT a
// live subscription. Renders nothing for non-admins (the real gate is server-side, against the
// verified token — this is only UI visibility). Placed in Info AND on the forced-trim screen, so
// the admin can escape a Standard over-limit state by switching back to Pro.
import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { setDevTier } from "../sync/api";

// Same address as Info's SUPPORT_EMAIL / the backend ADMIN_EMAIL — not secret. Controls only whether
// these buttons are shown; the backend rejects non-admins regardless.
const ADMIN_EMAIL = "zabieru.0407@gmail.com";
const SEVEN_MONTHS_MS = 210 * 24 * 60 * 60 * 1000;

export function DevTierSwitch() {
  const user = useAuth((s) => s.user);
  const [busy, setBusy] = useState(false);
  if (user?.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return null;

  const apply = async (tier: "standard" | "pro" | "admin", downgradedAt?: number | null) => {
    if (busy) return;
    setBusy(true);
    try {
      await setDevTier(tier, downgradedAt);
      // Reload so every tier-dependent gate re-reads: usage count, the over-limit trim gate, the
      // cloud section, the plan display.
      window.location.reload();
    } catch (e) {
      alert("プラン切替に失敗しました: " + (e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  };

  return (
    <div className="dev-panel">
      <p className="dev-title">🛠 開発者ツール（管理者のみ）— プラン切替（テスト用）</p>
      <div className="dev-row">
        <button className="btn sm" disabled={busy} onClick={() => void apply("standard")}>
          Standard
        </button>
        <button className="btn sm" disabled={busy} onClick={() => void apply("pro")}>
          Pro
        </button>
        <button className="btn sm" disabled={busy} onClick={() => void apply("admin")}>
          管理者（無制限）に戻す
        </button>
      </div>
      <button
        className="btn sm ghost"
        disabled={busy}
        onClick={() => void apply("standard", Date.now() - SEVEN_MONTHS_MS)}
      >
        Standard＋降格を7ヶ月前に（リテンション検証用）
      </button>
      <p className="muted small">
        切替後にページを再読み込みします。テスト専用で、管理者アカウントにのみ表示・操作できます。
      </p>
    </div>
  );
}
