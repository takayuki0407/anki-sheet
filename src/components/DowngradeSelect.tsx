// 強制トリム — shown (forced, by App's gate) when the server flags `trim_required` after a downgrade
// left the account over its book cap. The list is the ACCOUNT-WIDE book set (all devices), so the
// user can pick the global kept set even for books not on this device. POST /api/sync/trim makes the
// kept set authoritative; this device then deletes its local copies of the non-kept books. Other
// devices follow on their next sync. Escape: back up first; or re-upgrade (DevTierSwitch / paywall).
import { useCallback, useEffect, useState } from "react";
import { listBooks, submitTrim, updateBookMeta, type AccountBook } from "../sync/api";
import { downloadDeck } from "../sync/deck";
import { deviceLabel } from "../sync/device";
import { deleteDeck, listDecks } from "../db/repo";
import { downloadBlob, exportBackup } from "../db/backup";
import { DevTierSwitch } from "./DevTierSwitch";

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function DowngradeSelect({
  keepLimit,
  onResolved,
}: {
  keepLimit: number;
  onResolved: () => void;
}) {
  const [books, setBooks] = useState<AccountBook[] | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [backedUp, setBackedUp] = useState(false);

  useEffect(() => {
    void listBooks()
      .then((u) => setBooks(u.books))
      .catch(() => setBooks([]));
  }, []);

  const toggle = useCallback(
    (id: string) =>
      setKeep((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else if (next.size < keepLimit) next.add(id); // can't keep more than the plan allows
        return next;
      }),
    [keepLimit],
  );

  const backup = useCallback(async () => {
    try {
      const blob = await exportBackup();
      downloadBlob(blob, `kiokumate-backup-${dateStamp()}.json`);
      setBackedUp(true);
    } catch (e) {
      alert("バックアップに失敗しました: " + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  const apply = useCallback(async () => {
    if (!books) return;
    const removeCount = books.length - keep.size;
    const warn = backedUp ? "" : "⚠ バックアップはまだ書き出していません。\n";
    if (
      !confirm(
        `${warn}選んだ ${keep.size} 冊をこの端末に保存します。外した ${removeCount} 冊のうち、クラウド保存がある本はクラウドに退避し、Proに戻すと復元できます（保持〜約6ヶ月）。クラウド保存の無い本（端末のみ）は完全に削除されます。Standardは端末間同期がないため、他の端末のローカルコピーは次回起動時に削除されます。`,
      )
    )
      return;
    setBusy(true);
    try {
      // Server makes the kept set authoritative (kept→active, others→retained/trimmed).
      const trim = await submitTrim([...keep]);
      if (trim.skipped) {
        // The server skipped the trim (no longer required — e.g. re-upgraded meanwhile):
        // nothing was demoted, so do NOT delete anything locally either.
        onResolved();
        return;
      }
      const locals = await listDecks();
      const localIds = new Set(locals.map((d) => d.bookId).filter(Boolean) as string[]);
      // Reconcile THIS device: delete local copies of books that weren't kept.
      for (const d of locals) {
        if (d.id != null && d.bookId && !keep.has(d.bookId)) await deleteDeck(d.id);
      }
      // Materialize kept books that aren't on THIS device (now allowed on any tier for active books),
      // then CLAIM the holder — but only AFTER a successful download, so a failure never leaves the
      // book with no device. A failed/large/offline download stays active in the cloud section to
      // retry ("ダウンロード待ち").
      const me = deviceLabel();
      for (const b of books) {
        if (keep.has(b.book_id) && !localIds.has(b.book_id) && b.size > 0) {
          try {
            await downloadDeck(b);
            await updateBookMeta(b.book_id, { device: me }).catch(() => {});
          } catch {
            /* leave it as cloud-only / download-pending; the bookshelf cloud section can retry */
          }
        }
      }
      onResolved();
    } catch (e) {
      alert("処理に失敗しました: " + (e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  }, [books, keep, backedUp, onResolved]);

  if (!books)
    return (
      <div className="panel">
        <p className="muted">読み込み中…</p>
      </div>
    );

  const target = Math.min(keepLimit, books.length);
  const canApply = keep.size === target && !busy;

  return (
    <div className="panel downgrade">
      <h2>残す本を選んでください</h2>
      <p className="muted">
        現在のプランの上限は {keepLimit} 冊です。アカウント全体（すべての端末）の本から、残す{" "}
        {keepLimit} 冊を選んでください。残した本はこの端末に保存されます。選ばなかった本のうち、
        クラウド保存がある本はクラウドに退避し、Proに戻すと復元できます（保持〜約6ヶ月）。クラウド
        保存の無い本（端末のみ）は完全に削除されます。
      </p>
      <p className="usage-line">
        <strong>
          {keep.size} / {target} 冊を選択
        </strong>
      </p>

      <ul className="trim-list">
        {books.map((b) => (
          <li key={b.book_id}>
            <button
              className={`trim-row${keep.has(b.book_id) ? " sel" : ""}`}
              onClick={() => toggle(b.book_id)}
            >
              <span className="trim-check">{keep.has(b.book_id) ? "✓" : ""}</span>
              <span className="trim-name">{b.name || "（無題）"}</span>
              <span className="trim-device muted small">{b.device ?? ""}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="tools-row downgrade-actions">
        <button className="btn ghost sm" onClick={backup} disabled={busy}>
          {backedUp ? "✓ バックアップ済み" : "バックアップを書き出す"}
        </button>
        <button className="btn primary" onClick={apply} disabled={!canApply}>
          {busy ? "処理中…" : `選んだ ${target} 冊を残す`}
        </button>
      </div>

      <DevTierSwitch />
    </div>
  );
}
