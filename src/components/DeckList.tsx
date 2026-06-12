import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  allReviews,
  answerCount,
  deleteBookQuestions,
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
  retainBook,
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

  // 今日の復習 (Premium): due SM-2 reviews across ALL books. The count is local data; the tier
  // (from listBooks below) decides between the live card and the locked upsell card.
  const [tier, setTier] = useState<string | null>(null);
  const reviewStats = useLiveQuery(async () => {
    const all = await allReviews();
    const now = Date.now();
    return { any: all.length > 0, due: all.filter((r) => r.dueAt <= now).length };
  }, []);

  // Books in the account that aren't on THIS device yet → offer a one-tap cloud download (Pro only).
  const [cloud, setCloud] = useState<AccountBook[] | null>(null);
  const [cloudPro, setCloudPro] = useState(false);
  useEffect(() => {
    if (!user) {
      setCloud(null);
      setCloudPro(false);
      setTier(null);
      return;
    }
    let live = true;
    void listBooks()
      .then(async (u) => {
        if (!live) return;
        setCloud(u.books);
        setCloudPro(u.unlimited); // cloud download/restore is Pro+ (incl. Premium / admin)
        setTier(u.tier);
        const locals = await listDecks();
        // Account-wide trim follow: the server marks trimmed/retained books non-active. Delete this
        // device's local copies of books the account no longer holds as active. (Books unknown to the
        // server — a fresh local import not yet registered — are left alone.)
        const known = new Set(u.books.map((b) => b.book_id));
        const active = new Set(
          u.books.filter((b) => (b.status ?? "active") === "active").map((b) => b.book_id),
        );
        // Single-home: on a NON-sync tier (Standard/Free) a book lives on exactly ONE device — the
        // one that trimmed/materialized it (the holder, `device`). Other devices drop their local
        // copy. Pro+ (sync) keeps multi-device copies, so this only runs for non-sync tiers.
        const me = deviceLabel();
        const singleHome = !u.unlimited;
        // Only a NON-empty response is authoritative for the *destructive* orphan cleanup below: a
        // transient empty/partial `listBooks` must never wipe registered local books.
        const canPrune = u.books.length > 0;
        // Reconcile favorite / latest-opened against a fresh read of the local decks (not the live
        // query) so a later optimistic toggle isn't clobbered. Server is authoritative for favorite.
        for (const local of locals) {
          if (local.id == null || !local.bookId) continue;
          if (known.has(local.bookId) && !active.has(local.bookId)) {
            await deleteDeck(local.id); // trimmed/retained on the account → follow
            void deleteBookQuestions(local.bookId).catch(() => {});
            continue;
          }
          if (!known.has(local.bookId)) {
            // Orphan cleanup (non-sync): a book we PREVIOUSLY registered is gone from the account →
            // another device unregistered it (freed the slot, e.g. cleared a size=0 device-only book
            // from its cloud section). Drop our stale local copy. A never-registered book (fresh
            // offline import not yet synced) is left alone.
            if (singleHome && canPrune && local.registered) {
              await deleteDeck(local.id);
              void deleteBookQuestions(local.bookId).catch(() => {});
            }
            continue;
          }
          const b = u.books.find((x) => x.book_id === local.bookId);
          if (!b) continue;
          if (singleHome && b.device && b.device !== me) {
            await deleteDeck(local.id); // held by another device → single-home drop
            void deleteBookQuestions(local.bookId).catch(() => {});
            continue;
          }
          const patch: { favorite?: boolean; openedAt?: number; registered?: boolean } = {};
          if (!!local.favorite !== !!b.favorite) patch.favorite = !!b.favorite;
          if ((b.opened_at ?? 0) > (local.openedAt ?? 0)) patch.openedAt = b.opened_at;
          if (!local.registered) patch.registered = true; // seen in the account → enable future orphan cleanup
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
  // Cloud section = every ACTIVE account book NOT on this device (retained/trimmed are never offered),
  // for BOTH tiers — including zero-holder books (`device == null`, e.g. a Pro local-delete that left
  // it cloud-only, or a failed trim download). Those aren't on any bookshelf, so the cloud section is
  // the ONLY place to free their account slot on a non-sync tier; gating on `device` would strand them.
  // A self-deleted book never flashes here: a bookshelf delete retains it (→ non-active) AND drops it
  // from `cloud` immediately (removeFromCloud). Download stays Pro-only + size>0 (see CloudBook).
  const remote = (cloud ?? []).filter((b) => {
    if ((b.status ?? "active") !== "active") return false;
    if (localIds.has(b.book_id)) return false;
    return true;
  });
  // Books the account has a downloadable cloud blob for (size>0). A LOCAL delete of a book with NO
  // cloud blob must ALSO free its account slot — otherwise it lingers as a phantom row that counts
  // toward the cap, can't be restored, and (pre-fix) was hidden from the cloud list.
  const cloudLoaded = cloud != null;
  const cloudBlobIds = new Set((cloud ?? []).filter((b) => b.size > 0).map((b) => b.book_id));
  // Drop a book from the cloud state immediately after it's released (retain/unregister), so a
  // bookshelf delete never flashes the same book into the cloud section before the next listBooks.
  const removeFromCloud = (id: string) =>
    setCloud((c) => c?.filter((x) => x.book_id !== id) ?? null);

  const onExport = async () => {
    const blob = await exportBackup();
    downloadBlob(blob, `kiokumate-backup-${dateStamp()}.json`);
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

      {tier === "premium" || tier === "admin" ? (
        reviewStats && reviewStats.due > 0 ? (
          <button className="review-card" onClick={() => setView({ name: "review" })}>
            <span className="review-card-title">📚 今日の復習 {reviewStats.due}問</span>
            <span className="review-card-sub">
              間違えやすい問題を、忘れる前のいまのタイミングで再出題します
            </span>
          </button>
        ) : null
      ) : reviewStats?.any && tier ? (
        <button
          className="review-card locked"
          onClick={() =>
            alert(
              "「今日の復習」はPremiumの機能です。解いた問題の正誤から、間違えやすい問題を最適なタイミングで再出題します。（プラン変更は現在iOSアプリから行えます）",
            )
          }
        >
          <span className="review-card-title">🔒 今日の復習（Premium）</span>
          <span className="review-card-sub">間違えやすい問題を最適なタイミングで再出題</span>
        </button>
      ) : null}

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
              <DeckBook
                key={v.deck.id}
                deck={v.deck}
                count={v.count}
                freeSlotOnDelete={
                  cloudLoaded && !!v.deck.bookId && !cloudBlobIds.has(v.deck.bookId)
                }
                cloudBacked={
                  cloudLoaded ? (v.deck.bookId ? cloudBlobIds.has(v.deck.bookId) : false) : null
                }
                cloudDevice={
                  (v.deck.bookId && cloud?.find((b) => b.book_id === v.deck.bookId)?.device) || null
                }
                nonSync={cloudLoaded && !cloudPro}
                onCloudRemoved={removeFromCloud}
              />
            ))}
          </div>
        </div>
      )}

      {remote.length > 0 && (
        <div className="cloud-section">
          <h3 className="section">クラウド（この端末にない本）</h3>
          <p className="muted small">
            {cloudPro
              ? "同じアカウントの本です。「この端末に取り込む」で追加、「クラウドから完全に削除」ですべての端末から削除します。"
              : "同じアカウントの、この端末にない本です。クラウド保存（☁️）がある本は「この端末に取り込む」で移せます。「…枠を空ける」でアカウントの枠を解放できますが、クラウド保存のない本は復元できません。"}
          </p>
          <ul className="cloud-list">
            {remote.map((b) => (
              <CloudBook
                key={b.book_id}
                book={b}
                canDownload={cloudPro}
                onRemoved={removeFromCloud}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A cloud account book not on this device. Download (size>0) works on EVERY tier — the server
 * opens an ACTIVE book's blob/content to its owner, so a downgraded Standard/Free account can
 * still materialize a cloud-only book instead of being forced to discard it. Pro+ additionally
 * gets「クラウドから完全に削除」; Standard/Free instead get the slot-freeing action — retain
 * (size>0, R2 kept, re-Pro restorable) or unregister (size=0, device-only → permanent). */
function CloudBook({
  book,
  canDownload,
  onRemoved,
}: {
  book: AccountBook;
  canDownload: boolean;
  onRemoved: (bookId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // size>0 = a real cloud copy (restorable on re-Pro); size=0 = device-only (delete = permanent).
  const hasBlob = book.size > 0;
  const holder = book.device || "";
  const title = book.name || "（無題）";
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
  // Pro+ : permanently delete from the cloud for ALL devices (R2 + registry row + progress).
  const removePermanent = async () => {
    if (
      !confirm(
        `「${title}」をクラウドから完全に削除しますか？\nすべての端末から取り込めなくなります。この操作は元に戻せません。`,
      )
    )
      return;
    setBusy(true);
    setErrMsg(null);
    try {
      await unregisterBook(book.book_id);
      onRemoved(book.book_id);
    } catch (e) {
      setErrMsg(syncErrorMessage(e));
      setBusy(false);
    }
  };
  // Standard/Free : single action — free the account slot. size>0 → retain (frees the slot, keeps R2
  // for re-Pro restore); size=0 → unregister (permanent). Wording adapts to whether a holder device is
  // known (another device) or not (zero-holder, cloud-only). Always confirm; warn harder with no copy.
  const release = async () => {
    const msg = !hasBlob
      ? `「${title}」を削除して枠を空けますか？\n⚠ クラウドに保存がないため、削除すると復元できません。`
      : holder
        ? `「${holder}」に保存中の「${title}」を枠から外しますか？\nクラウドに退避し、Proに戻すと復元できます（保持〜約6ヶ月）。`
        : `「${title}」をクラウドから外して枠を空けますか？\nProに戻すと復元できます（保持〜約6ヶ月）。`;
    if (!confirm(msg)) return;
    setBusy(true);
    setErrMsg(null);
    try {
      if (hasBlob) await retainBook(book.book_id);
      else await unregisterBook(book.book_id);
      onRemoved(book.book_id);
    } catch (e) {
      setErrMsg(syncErrorMessage(e));
      setBusy(false);
    }
  };
  return (
    <li className="cloud-item">
      <span className="cloud-name">{title}</span>
      <span className={`cloud-badge ${hasBlob ? "ok" : "warn"}`}>
        {hasBlob ? "☁️ クラウドあり" : "端末のみ（復元不可）"}
      </span>
      <span className="cloud-device">
        {holder ? `「${holder}」に保存` : "クラウドのみ（端末未保存）"}
      </span>
      {hasBlob && (
        <button className="btn sm" onClick={download} disabled={busy}>
          {busy ? "取り込み中…" : errMsg ? "再試行" : "この端末に取り込む"}
        </button>
      )}
      {canDownload ? (
        <button className="btn sm danger-outline" onClick={removePermanent} disabled={busy}>
          クラウドから完全に削除
        </button>
      ) : (
        <button
          className="btn sm danger-outline"
          onClick={release}
          disabled={busy}
          title={hasBlob ? "枠を空けます（クラウドに退避・Proで復元可）" : "枠を空けます（復元不可）"}
        >
          {holder ? `「${holder}」から削除（枠を空ける）` : "クラウドから外す（枠を空ける）"}
        </button>
      )}
      {errMsg && <p className="cloud-error">{errMsg}</p>}
    </li>
  );
}

function DeckBook({
  deck,
  count,
  freeSlotOnDelete,
  cloudBacked,
  cloudDevice,
  nonSync,
  onCloudRemoved,
}: {
  deck: DeckRow;
  count: number;
  freeSlotOnDelete: boolean;
  /** true = the account has a cloud copy (size>0, restorable on re-Pro); false = device-only
   * (delete = permanent); null = unknown (offline / not yet fetched → warn on the safe side). */
  cloudBacked: boolean | null;
  /** The account book's current holder name, or null (no holder / unknown). */
  cloudDevice: string | null;
  /** true = a known NON-sync tier (Standard/Free): a cloud-backed local delete RETAINS the book
   * (frees the slot, keeps R2) instead of leaving a stuck cloud-only active row. */
  nonSync: boolean;
  /** Drop a just-released book from the parent's cloud state, so it doesn't flash into the cloud
   * section between this local delete and the next listBooks (called on retain/unregister only). */
  onCloudRemoved: (bookId: string) => void;
}) {
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
    // Branch the warning on cloud-copy + tier: device-only (size=0/unknown) = permanent; cloud-backed
    // on a non-sync tier = retained (frees a slot, re-Pro restorable); cloud-backed on Pro = kept.
    const msg =
      cloudBacked !== true
        ? `「${deck.name}」をこの端末から削除しますか？\n⚠ この本は端末内だけにあります。削除すると復元できません。`
        : nonSync
          ? `「${deck.name}」をこの端末から削除しますか？\nこの端末から削除し、クラウドに退避します（枠が空きます）。Proに戻すと復元できます（保持〜約6ヶ月）。`
          : `「${deck.name}」をこの端末から削除しますか？\nこの本はクラウドにバックアップがあります。Proに戻せば、あとで「クラウド」から取り込み直せます。`;
    if (!confirm(msg)) return;
    // Local delete. size=0 (no cloud copy) → unregister (permanent, frees the slot). size>0 on a
    // non-sync tier → retain (active→retained: frees the slot, keeps R2, restorable on re-Pro).
    // size>0 on Pro+ → keep active (re-download possible; just release the holder if we held it).
    await deleteDeck(deck.id!);
    if (deck.bookId) {
      void deleteBookQuestions(deck.bookId).catch(() => {}); // drop this device's AI questions
      if (freeSlotOnDelete) {
        void unregisterBook(deck.bookId).catch(() => {}); // size=0 → permanent, frees the slot
        onCloudRemoved(deck.bookId); // don't flash it into the cloud section
      } else if (cloudBacked === true && nonSync) {
        // Standard/Free: retain (active→retained) — frees the slot, keeps R2 for re-Pro restore.
        void retainBook(deck.bookId).catch(() => {});
        onCloudRemoved(deck.bookId); // retained ⇒ no longer active ⇒ drop from the cloud section now
      } else if (cloudBacked === true && cloudDevice === deviceLabel()) {
        // Pro+ holder: keep the book active (re-downloadable); just release the holder so the
        // bookshelf stops showing this device ("cloud-only").
        void updateBookMeta(deck.bookId, { device: null }).catch(() => {});
      }
    }
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
      <div className="book-meta">
        {count} 個の暗記
        {cloudBacked === true && (
          <span className="book-badge cloud" title="クラウドにバックアップあり（Proに戻せば復元可）">
            ☁️ クラウドあり
          </span>
        )}
        {cloudBacked === false && (
          <span className="book-badge local" title="端末内のみ（削除すると復元できません）">
            端末のみ
          </span>
        )}
      </div>
      <div className="book-actions">
        <button className="btn ghost sm" onClick={() => setView({ name: "quiz", deckId: deck.id! })}>
          問題
        </button>
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
