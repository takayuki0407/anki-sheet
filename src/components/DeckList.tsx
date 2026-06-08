import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  answerCount,
  deleteDeck,
  getCover,
  getDeckPdf,
  listDecks,
  setCover,
  updateDeck,
} from "../db/repo";
import { renderCover } from "../pdf/pdfEngine";
import { downloadBlob, exportBackup, importBackup } from "../db/backup";
import { useApp } from "../store/session";
import { useAuth } from "../auth/useAuth";
import {
  listBooks,
  syncErrorMessage,
  unregisterBook,
  updateBookMeta,
  type AccountBook,
} from "../sync/api";
import { backfillCloudIfPro, downloadDeck } from "../sync/deck";
import { deviceLabel } from "../sync/device";
import type { DeckRow } from "../types";

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

interface DeckVM {
  deck: DeckRow;
  count: number;
}
type SortMode = "new" | "name" | "recent";
const SORT_LABELS: Record<SortMode, string> = {
  new: "新しい順",
  name: "名前順",
  recent: "最近開いた順",
};

/** Favorites pinned to the top, then ordered by the chosen mode. */
function sortVms(vms: DeckVM[], mode: SortMode): DeckVM[] {
  return [...vms].sort((a, b) => {
    const fav = (b.deck.favorite ? 1 : 0) - (a.deck.favorite ? 1 : 0);
    if (fav !== 0) return fav;
    if (mode === "name") return a.deck.name.localeCompare(b.deck.name, "ja");
    if (mode === "recent") return (b.deck.openedAt ?? 0) - (a.deck.openedAt ?? 0);
    return b.deck.createdAt - a.deck.createdAt;
  });
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
  const vms = useLiveQuery(
    async () =>
      Promise.all(
        (await listDecks()).map(async (deck) => ({ deck, count: await answerCount(deck.id!) })),
      ),
    [],
  );
  const decks = vms?.map((v) => v.deck);
  const [sort, setSort] = useState<SortMode>(
    () => (localStorage.getItem("shelfSort") as SortMode) || "new",
  );
  const sorted = vms ? sortVms(vms, sort) : undefined;
  const importRef = useRef<HTMLInputElement>(null);
  const user = useAuth((s) => s.user);

  // Books in the account that aren't on THIS device yet → offer a one-tap cloud download (Pro only).
  const [cloud, setCloud] = useState<AccountBook[] | null>(null);
  const [cloudPro, setCloudPro] = useState(false);
  useEffect(() => {
    if (!user) {
      setCloud(null);
      setCloudPro(false);
      return;
    }
    let live = true;
    void listBooks()
      .then(async (u) => {
        if (!live) return;
        setCloud(u.books);
        setCloudPro(u.tier === "pro" || u.tier === "admin"); // cloud download/restore is Pro-only
        // Reconcile favorite / latest-opened set on other devices ONCE per fetch, against a fresh
        // read of the local decks (not the live query) so a later optimistic toggle isn't clobbered
        // by a stale snapshot. Server is authoritative for favorite; opened_at takes the most recent.
        const locals = await listDecks();
        for (const b of u.books) {
          const local = locals.find((d) => d.bookId === b.book_id);
          if (!local?.id) continue;
          const patch: { favorite?: boolean; openedAt?: number } = {};
          if (!!local.favorite !== !!b.favorite) patch.favorite = !!b.favorite;
          if ((b.opened_at ?? 0) > (local.openedAt ?? 0)) patch.openedAt = b.opened_at;
          if (Object.keys(patch).length) await updateDeck(local.id, patch);
        }
        void backfillCloudIfPro(); // Pro: upload any local book that has no cloud file yet
      })
      .catch(() => {
        if (live) setCloud(null);
      });
    return () => {
      live = false;
    };
  }, [user]);

  const localIds = new Set(((decks ?? []).map((d) => d.bookId).filter(Boolean) as string[]));
  const remote = (cloud ?? []).filter((b) => !localIds.has(b.book_id));

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
          ＋ 取り込む
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
        <label className="sort-control">
          並び替え
          <select
            value={sort}
            onChange={(e) => {
              const v = e.target.value as SortMode;
              setSort(v);
              localStorage.setItem("shelfSort", v);
            }}
          >
            {(["new", "name", "recent"] as SortMode[]).map((m) => (
              <option key={m} value={m}>
                {SORT_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {decks === undefined && <p className="muted">読み込み中…</p>}
      {decks && decks.length === 0 && (
        <div className="empty">
          <p>本棚は空です。</p>
          <p className="muted">赤シート対応のPDFを取り込んで並べましょう。</p>
        </div>
      )}

      {sorted && sorted.length > 0 && (
        <div className="bookshelf">
          <div className="book-grid">
            {sorted.map((v) => (
              <DeckBook key={v.deck.id} deck={v.deck} count={v.count} />
            ))}
          </div>
        </div>
      )}

      {cloudPro && remote.some((b) => b.size > 0) && (
        <div className="cloud-section">
          <h3 className="section">クラウド（この端末にない本）</h3>
          <p className="muted small">
            同じアカウントの本です。「この端末に取り込む」で追加、「クラウドから削除」で
            すべての端末から完全に削除します。
          </p>
          <ul className="cloud-list">
            {remote
              .filter((b) => b.size > 0)
              .map((b) => (
                <CloudBook
                  key={b.book_id}
                  book={b}
                  onRemoved={(id) => setCloud((c) => c?.filter((x) => x.book_id !== id) ?? null)}
                />
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A Pro cloud book not on this device — download it back, or permanently remove it from the cloud
 * (which deletes the R2 file + registry row for the whole account). */
function CloudBook({ book, onRemoved }: { book: AccountBook; onRemoved: (bookId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setErrMsg(null);
    try {
      await downloadDeck(book); // on success the local deck appears (live query) → this row unmounts
      // Stamp THIS device as the current holder so the cloud list (on other devices) shows where the
      // book is now, not just who first imported it.
      void updateBookMeta(book.book_id, { device: deviceLabel() }).catch(() => {});
    } catch (e) {
      setErrMsg(syncErrorMessage(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !confirm(
        `「${book.name || "（無題）"}」をクラウドから完全に削除しますか？\nすべての端末から取り込めなくなります。この操作は元に戻せません。`,
      )
    )
      return;
    setBusy(true);
    setErrMsg(null);
    try {
      await unregisterBook(book.book_id); // deletes the R2 PDF/content + registry row + progress
      onRemoved(book.book_id);
    } catch (e) {
      setErrMsg(syncErrorMessage(e));
      setBusy(false);
    }
  };
  return (
    <li className="cloud-item">
      <span className="cloud-name">{book.name || "（無題）"}</span>
      <span className="cloud-device">{book.device ?? ""}</span>
      <button className="btn sm" onClick={download} disabled={busy}>
        {busy ? "取り込み中…" : errMsg ? "再試行" : "この端末に取り込む"}
      </button>
      <button className="btn sm ghost" onClick={remove} disabled={busy}>
        クラウドから削除
      </button>
      {errMsg && <p className="cloud-error">{errMsg}</p>}
    </li>
  );
}

function DeckBook({ deck, count }: { deck: DeckRow; count: number }) {
  const setView = useApp((s) => s.setView);
  const cover = useCover(deck.id!);

  const open = () => {
    const now = Date.now();
    void updateDeck(deck.id!, { openedAt: now }); // for 最近開いた順
    if (deck.bookId && useAuth.getState().user)
      void updateBookMeta(deck.bookId, { openedAt: now }).catch(() => {});
    setView({ name: "viewer", deckId: deck.id! });
  };
  const onDelete = async () => {
    if (
      !confirm(
        `「${deck.name}」をこの端末から削除しますか？\nクラウドに保存されている本は、あとで「クラウド」から取り込み直せます。`,
      )
    )
      return;
    // Local-only delete: do NOT remove the cloud copy. The account's cloud master persists so OTHER
    // devices keep it and this device can re-download it later. Permanent cloud deletion is the
    // explicit「クラウドから削除」action in the cloud section.
    await deleteDeck(deck.id!);
  };
  const toggleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !deck.favorite;
    void updateDeck(deck.id!, { favorite: next });
    if (deck.bookId && useAuth.getState().user)
      void updateBookMeta(deck.bookId, { favorite: next }).catch(() => {});
  };

  return (
    <div className="book">
      <button className="book-cover" title={deck.name} onClick={open}>
        {cover ? (
          <img src={cover} alt={deck.name} loading="lazy" />
        ) : (
          <span className="cover-fallback">{deck.name}</span>
        )}
      </button>
      <button
        className={`fav-btn ${deck.favorite ? "on" : ""}`}
        onClick={toggleFav}
        title={deck.favorite ? "お気に入りを解除" : "お気に入りに追加"}
        aria-label="お気に入り"
      >
        {deck.favorite ? "★" : "☆"}
      </button>
      <div className="book-title" title={deck.name}>
        {deck.name}
      </div>
      <div className="book-meta">{count} 個の暗記</div>
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
