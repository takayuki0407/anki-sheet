import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  answerCount,
  deleteDeck,
  getCover,
  getDeckPdf,
  listDecks,
  setCover,
} from "../db/repo";
import { renderCover } from "../pdf/pdfEngine";
import { downloadBlob, exportBackup, importBackup } from "../db/backup";
import { useApp } from "../store/session";
import { useAuth } from "../auth/useAuth";
import { unregisterBook } from "../sync/api";
import type { DeckRow } from "../types";

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// Serialize cover generation so visiting the shelf doesn't parse every PDF at once.
let coverChain: Promise<unknown> = Promise.resolve();
function enqueueCover<T>(fn: () => Promise<T>): Promise<T> {
  const run = coverChain.then(fn, fn);
  coverChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Cover thumbnail for a deck: cached in IndexedDB, generated lazily from page 1. */
function useCover(deckId: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        let cover = await getCover(deckId);
        if (!cover && !cancelled) {
          cover = await enqueueCover(async () => {
            if (cancelled) return undefined;
            const existing = await getCover(deckId); // another mount may have made it
            if (existing) return existing;
            const pdf = await getDeckPdf(deckId);
            if (!pdf || cancelled) return undefined;
            const blob = await renderCover(pdf.blob);
            if (cancelled) return undefined; // don't write an orphan cover after delete
            await setCover(deckId, blob);
            return { deckId, blob };
          });
        }
        if (cover && !cancelled) {
          objectUrl = URL.createObjectURL(cover.blob);
          setUrl(objectUrl);
        }
      } catch {
        /* leave placeholder */
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [deckId]);
  return url;
}

export function DeckList() {
  const setView = useApp((s) => s.setView);
  const decks = useLiveQuery(() => listDecks(), []);
  const importRef = useRef<HTMLInputElement>(null);

  const onExport = async () => {
    const blob = await exportBackup();
    downloadBlob(blob, `anki-sheet-backup-${dateStamp()}.json`);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!confirm("バックアップを読み込み、現在のすべてのデータを置き換えます。よろしいですか？")) return;
    try {
      await importBackup(f);
      alert("復元しました。");
    } catch (err) {
      alert("読み込みに失敗しました: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>本棚</h2>
        <button className="btn primary" onClick={() => setView({ name: "import" })}>
          ＋ PDFを取り込む
        </button>
      </div>

      <div className="tools-row">
        <button className="btn ghost sm" onClick={onExport} disabled={!decks?.length}>
          バックアップを書き出す
        </button>
        <button className="btn ghost sm" onClick={() => importRef.current?.click()}>
          バックアップを読み込む
        </button>
        <input ref={importRef} type="file" accept="application/json" hidden onChange={onImportFile} />
      </div>

      {decks === undefined && <p className="muted">読み込み中…</p>}
      {decks && decks.length === 0 && (
        <div className="empty">
          <p>本棚は空です。</p>
          <p className="muted">赤シート対応のPDFを取り込んで並べましょう。</p>
        </div>
      )}

      {decks && decks.length > 0 && (
        <div className="bookshelf">
          <div className="book-grid">
            {decks.map((d) => (
              <DeckBook key={d.id} deck={d} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DeckBook({ deck }: { deck: DeckRow }) {
  const setView = useApp((s) => s.setView);
  const cover = useCover(deck.id!);
  const count = useLiveQuery(() => answerCount(deck.id!), [deck.id]);

  const onDelete = async () => {
    if (!confirm(`「${deck.name}」を削除しますか？`)) return;
    await deleteDeck(deck.id!);
    // Free the account-global slot (best-effort; ignore when offline / signed out).
    if (deck.bookId && useAuth.getState().user) void unregisterBook(deck.bookId).catch(() => {});
  };

  return (
    <div className="book">
      <button
        className="book-cover"
        title={deck.name}
        onClick={() => setView({ name: "viewer", deckId: deck.id! })}
      >
        {cover ? (
          <img src={cover} alt={deck.name} loading="lazy" />
        ) : (
          <span className="cover-fallback">{deck.name}</span>
        )}
      </button>
      <div className="book-title" title={deck.name}>
        {deck.name}
      </div>
      <div className="book-meta">{count ?? "…"} 個の暗記</div>
      <div className="book-actions">
        <button
          className="btn ghost sm"
          onClick={() => setView({ name: "settings", deckId: deck.id! })}
        >
          設定
        </button>
        <button className="btn ghost sm" onClick={onDelete}>
          削除
        </button>
      </div>
    </div>
  );
}
