// 強制トリム — shown (forced, by App's over-limit Gate) when a non-Pro account holds MORE local
// books than the per-device limit. This happens after a future Pro→Standard downgrade, or as a
// leftover over-limit state. The user picks which books to KEEP on this device; the rest are
// deleted LOCALLY. The cloud copy (Pro-uploaded) is preserved so re-upgrading to Pro can restore
// them (purged after 6 months by the retention job). Escape: back up first. No web paywall yet,
// so "keep everything" means staying on Pro (handled on iOS for now).
import { useCallback, useEffect, useState } from "react";
import { deleteDeck, getCover, listDecks } from "../db/repo";
import { downloadBlob, exportBackup } from "../db/backup";
import type { DeckRow } from "../types";

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** Show the cached cover if one exists. We do NOT generate covers here (no heavy PDF parse on a
 * forced screen) — a book with no cached cover falls back to its name. */
function useCachedCover(deckId: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void getCover(deckId).then((c) => {
      if (cancelled || !c) return;
      objectUrl = URL.createObjectURL(c.blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [deckId]);
  return url;
}

export function DowngradeSelect({ keepLimit }: { keepLimit: number }) {
  const [decks, setDecks] = useState<DeckRow[] | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [backedUp, setBackedUp] = useState(false);

  useEffect(() => {
    void listDecks().then(setDecks);
  }, []);

  const toggle = useCallback(
    (id: number) => {
      setKeep((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else if (next.size < keepLimit) next.add(id); // can't select more than we're allowed to keep
        return next;
      });
    },
    [keepLimit],
  );

  const backup = useCallback(async () => {
    try {
      const blob = await exportBackup();
      downloadBlob(blob, `anki-sheet-backup-${dateStamp()}.json`);
      setBackedUp(true);
    } catch (e) {
      alert("バックアップに失敗しました: " + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  const apply = useCallback(async () => {
    if (!decks) return;
    const remove = decks.filter((d) => !keep.has(d.id!));
    const warn = backedUp ? "" : "⚠ バックアップはまだ書き出していません。\n";
    if (
      !confirm(
        `${warn}選んだ ${keep.size} 冊を残し、ほかの ${remove.length} 冊をこの端末から削除します。この操作は元に戻せません。`,
      )
    )
      return;
    try {
      setBusy(true);
      // Delete the non-kept books from THIS device only. The cloud copy (Pro) is KEPT (NOT
      // unregistered) so re-upgrading to Pro can restore it. Per-device limit, so the account/cloud
      // registry is intentionally not trimmed here. App's live deck count clears the gate once we're
      // at/under the limit.
      for (const d of remove) await deleteDeck(d.id!);
    } catch (e) {
      alert("削除に失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [decks, keep, backedUp]);

  if (!decks)
    return (
      <div className="panel">
        <p className="muted">読み込み中…</p>
      </div>
    );

  const target = Math.min(keepLimit, decks.length);
  const canApply = keep.size === target && !busy;

  return (
    <div className="panel downgrade">
      <h2>残す本を選んでください</h2>
      <p className="muted">
        現在のプラン（Standard）では、この端末に本を {keepLimit} 冊まで保存できます。いまこの端末には{" "}
        {decks.length} 冊あります。残す本を {keepLimit} 冊選んでください。選ばなかった本はこの端末から
        削除されます（Proで取り込んだ本はクラウドに保持され、再びProにすると復元できます）。すべて残したい
        場合は Pro（無制限）をご利用ください。
      </p>
      <p className="usage-line">
        <strong>
          {keep.size} / {target} 冊を選択
        </strong>
      </p>

      <div className="book-grid">
        {decks.map((d) => (
          <TrimBook key={d.id} deck={d} selected={keep.has(d.id!)} onToggle={() => toggle(d.id!)} />
        ))}
      </div>

      <div className="tools-row downgrade-actions">
        <button className="btn ghost sm" onClick={backup} disabled={busy}>
          {backedUp ? "✓ バックアップ済み" : "バックアップを書き出す"}
        </button>
        <button className="btn primary" onClick={apply} disabled={!canApply}>
          {busy ? "削除中…" : `選んだ ${target} 冊を残して削除`}
        </button>
      </div>
    </div>
  );
}

function TrimBook({
  deck,
  selected,
  onToggle,
}: {
  deck: DeckRow;
  selected: boolean;
  onToggle: () => void;
}) {
  const cover = useCachedCover(deck.id!);
  return (
    <button className={`trim-book${selected ? " sel" : ""}`} onClick={onToggle}>
      <div className="book-cover">
        {cover ? (
          <img src={cover} alt={deck.name} loading="lazy" />
        ) : (
          <span className="cover-fallback">{deck.name}</span>
        )}
      </div>
      <div className="book-title" title={deck.name}>
        {deck.name}
      </div>
      {selected && <span className="trim-badge">✓</span>}
    </button>
  );
}
