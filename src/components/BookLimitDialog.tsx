// Shown when importing would exceed the account-global book cap. Offers a Pro upsell, and lets
// the user free a slot by deleting one of the existing books — each labelled with the device it
// was imported on — then completes the pending import.
import { useEffect, useState } from "react";
import type { PdfDetectionResult } from "../pdf/pdfEngine";
import { deleteDeck, listDecks } from "../db/repo";
import { listBooks, registerBook, unregisterBook, type AccountBook } from "../sync/api";
import { deviceLabel } from "../sync/device";

export interface PendingImport {
  bookId: string;
  deckName: string;
  result: PdfDetectionResult;
  blob: Blob;
  limit: number;
  /** Set only when the server registration GENUINELY succeeded (never on the offline/fail-open path),
   * so reconcile can later follow an elsewhere-unregister without deleting an unsynced local import. */
  registered?: boolean;
}

export function BookLimitDialog({
  pending,
  onImport,
  onCancel,
  onUpgrade,
}: {
  pending: PendingImport;
  onImport: (p: PendingImport) => Promise<void>;
  onCancel: () => void;
  onUpgrade: () => void;
}) {
  const [books, setBooks] = useState<AccountBook[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const thisDevice = deviceLabel();

  const load = () => {
    setBooks(null);
    void listBooks()
      .then((u) => setBooks(u.books))
      .catch(() => setBooks([]));
  };
  useEffect(load, []);

  const toggle = (id: string) =>
    setSel((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const proceed = async () => {
    if (sel.size === 0) return;
    setBusy(true);
    setMsg("");
    try {
      // Free the chosen slots: unregister each, and delete the local copy if it's on this device.
      const decks = await listDecks();
      for (const bid of sel) {
        await unregisterBook(bid).catch(() => {});
        const local = decks.find((d) => d.bookId === bid);
        if (local?.id != null) await deleteDeck(local.id);
      }
      // Retry reserving a slot for the new book.
      const r = await registerBook(pending.bookId, pending.deckName, pending.result.pageCount);
      if (!r.ok && r.limitReached) {
        setMsg("まだ上限を超えています。もう少し削除してください。");
        setSel(new Set());
        load();
        return;
      }
      await onImport({ ...pending, registered: true }); // registerBook above succeeded
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal limit-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>保存上限に達しました</h3>
        <p className="muted small">
          Standardプランは全ての端末あわせて <strong>{pending.limit}冊</strong> までです。
          新しい本「{pending.deckName}」を取り込むには、Proにアップグレードするか、削除する本を選んでください。
        </p>
        <button className="btn primary" onClick={onUpgrade} disabled={busy}>
          Pro にアップグレード（冊数無制限・クラウド同期）
        </button>

        <p className="section-label">削除する本を選ぶ</p>
        {books === null ? (
          <p className="muted small">読み込み中…</p>
        ) : books.length === 0 ? (
          <p className="muted small">登録された本がありません。</p>
        ) : (
          <ul className="limit-book-list">
            {books.map((b) => (
              <li key={b.book_id} className={sel.has(b.book_id) ? "sel" : ""}>
                <label>
                  <input
                    type="checkbox"
                    checked={sel.has(b.book_id)}
                    onChange={() => toggle(b.book_id)}
                  />
                  <span className="limit-book-name">{b.name || "（無題）"}</span>
                  <span className="limit-book-device">
                    {b.device ?? "不明な端末"}
                    {b.device === thisDevice ? "（この端末）" : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {msg && <p className="auth-msg">{msg}</p>}
        <div className="row">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            やめる
          </button>
          <button className="btn primary" onClick={proceed} disabled={busy || sel.size === 0}>
            {busy ? "処理中…" : `選択した ${sel.size} 冊を削除して取り込む`}
          </button>
        </div>
      </div>
    </div>
  );
}
