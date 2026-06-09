import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  addBookmark,
  addCard,
  deckCards,
  deleteBookmark,
  deleteCard,
  getDeck,
  getDeckPdf,
  listBookmarks,
  renameBookmark,
  replaceBookmarks,
  updateDeck,
} from "../db/repo";
import { loadPdf } from "../pdf/pdfEngine";
import { PageOverlay, type FitMode, type MaskGroup } from "../render/PageOverlay";
import { ContinuousView } from "./ContinuousView";
import { useApp } from "../store/session";
import { useAuth } from "../auth/useAuth";
import { getProgress, putProgress } from "../sync/api";
import {
  type StarMap,
  type BmMap,
  normalize,
  mergeBlobs,
  activeStarKeys,
  activeBookmarks,
  setActiveStars,
  setActiveBookmarks,
  addBm,
} from "../sync/progressMerge";
import { refreshContent, uploadContent } from "../sync/deck";
import { cardKeyMaps as cardKeyMapsFlat } from "../sync/cardKeys";
import type { BookmarkRow, CardRow, PdfRow, Rect } from "../types";

type Status = "loading" | "ready" | "error";
type Mode = "paged" | "scroll";
// Zoom is a continuous multiplier on the fit base, stepped in 10% increments and
// typeable as a percentage.
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

interface Band {
  top: number;
  height: number;
}

/** A staged (not yet saved) manually-added mask. Negative tempId so it never collides with a card id. */
interface EditAdd {
  tempId: number;
  pageIndex: number;
  rect: Rect;
}
/** Do two page-coordinate rects overlap? (used by 範囲一括削除). */
function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

type RedMode = "mask" | "sheet" | "off";

/**
 * Manual red sheet (縦読み only): a draggable red band you slide over the page like a physical
 * red sheet. The band is just a faint tint (black body text stays crisp); the detection masks do
 * the hiding, gated by the band's position (ContinuousView.gateMasks) — answers above the top
 * edge are revealed, below stay hidden. Only the top grip drags (the bottom is pinned); the body
 * is pointer-events:none so the page scrolls through it.
 */
function RedSheet({
  band,
  onChange,
  hostRef,
}: {
  band: Band;
  onChange: (b: Band) => void;
  hostRef: React.RefObject<HTMLDivElement | null>;
}) {
  const drag = useRef<{ y: number; top: number } | null>(null);
  const begin = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { y: e.clientY, top: band.top };
  };
  // Only the top edge moves (the bottom is pinned to the viewport bottom via CSS).
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const hh = hostRef.current?.clientHeight ?? 0;
    const top = Math.max(0, Math.min(Math.max(0, hh - 28), d.top + (e.clientY - d.y)));
    onChange({ top, height: Math.max(0, hh - top) });
  };
  const end = (e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  // The sheet body has pointer-events:none (scroll the page through it); a small, semi-transparent
  // handle centred on the top edge resizes it.
  return (
    <>
      <div className="red-sheet" style={{ top: band.top }} />
      <div
        className="red-sheet-grip"
        style={{ top: band.top - 10 }}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </>
  );
}

/** Standalone digital red sheet: page through (or scroll) a PDF, hide/show answers. */
// Device-portable ★/revealed keys come from sync/cardKeys (page + quantized answer position, stable
// across answer add/remove and re-detect). This thin wrapper adapts the viewer's page-grouped map.
function cardKeyMaps(cardsByPage: Map<number, CardRow[]>) {
  return cardKeyMapsFlat([...cardsByPage.values()].flat());
}

export function PageViewer({ deckId }: { deckId: number }) {
  const setView = useApp((s) => s.setView);
  const user = useAuth((s) => s.user);
  // Reveal keys pulled from the cloud, applied once the page's cards have loaded (see effect).
  const [pendingRevealKeys, setPendingRevealKeys] = useState<string[] | null>(null);
  const [pendingStarKeys, setPendingStarKeys] = useState<string[] | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [pdf, setPdf] = useState<PdfRow>();
  const [deckName, setDeckName] = useState("");
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const bookIdRef = useRef<string | undefined>(undefined); // for cross-device progress sync
  const starMapRef = useRef<StarMap>({}); // ★ LWW-element-set for §4.2 per-key merge sync
  const bmMapRef = useRef<BmMap>({}); // しおり LWW-element-set
  const [docReady, setDocReady] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [zoomEdit, setZoomEdit] = useState<string | null>(null); // raw text while typing %
  // Always fit-to-width: the page fills the screen horizontally and you scroll down (like the
  // Kindle app); users change the magnification with the ± / % controls. (The 全体表示 toggle
  // was removed.)
  const fitMode: FitMode = "width";
  const [mode, setMode] = useState<Mode>("scroll"); // 縦読み by default
  const [jumpNonce, setJumpNonce] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  // Red overlay mode (exclusive): 赤マスク (detection masks) / 赤シート (draggable band, 縦読み
  // only) / OFF. Persisted, along with the band's position+size.
  const [redMode, setRedMode] = useState<RedMode>("mask");
  const [band, setBand] = useState<Band>({ top: 60, height: 150 });
  const sheetHostRef = useRef<HTMLDivElement>(null);
  const sheetOn = redMode === "mask";
  // Manual mask editing (paged mode): tap a mask to delete it, drag to add one. Edits are STAGED
  // (added/removed in a local buffer) and only written to the DB on 保存; キャンセル discards them.
  const [editMode, setEditMode] = useState(false);
  const [drawMode, setDrawMode] = useState<"add" | "delete" | null>(null);
  const [editAdds, setEditAdds] = useState<EditAdd[]>([]);
  const [editDels, setEditDels] = useState<Set<number>>(new Set());
  const [history, setHistory] = useState<{ adds: EditAdd[]; dels: Set<number> }[]>([]);
  const tempIdRef = useRef(-1);
  // Study tracking: starred answers (long-press a mask) + a review-only mode that masks just them.
  const [starred, setStarred] = useState<Set<number>>(new Set());
  const [starMode, setStarMode] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewerRef.current?.requestFullscreen();
    } catch {
      /* fullscreen may be blocked; ignore */
    }
  };
  // iOS Safari has no Fullscreen API (and PWAs are already full-screen).
  const fullscreenSupported =
    typeof document !== "undefined" && !!document.documentElement.requestFullscreen;

  const bookmarks = useLiveQuery(() => listBookmarks(deckId), [deckId]) ?? [];
  const allCards = useLiveQuery(
    () => (status === "ready" ? deckCards(deckId) : Promise.resolve([])),
    [deckId, status],
  );
  const cardsByPage = useMemo(() => {
    const m = new Map<number, CardRow[]>();
    for (const c of allCards ?? []) {
      const arr = m.get(c.pageIndex) ?? [];
      arr.push(c);
      m.set(c.pageIndex, arr);
    }
    return m;
  }, [allCards]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setDocReady(false);
    (async () => {
      try {
        const d = await getDeck(deckId);
        if (!d) throw new Error("デッキが見つかりません");
        const p = await getDeckPdf(deckId);
        if (!p) throw new Error("PDFが見つかりません");
        const doc = await loadPdf(p.blob);
        if (cancelled) {
          await doc.loadingTask.destroy();
          return;
        }
        docRef.current = doc;
        setPdf(p);
        setDeckName(d.name);
        // reopen where we left off, in the reading mode used last time
        setPageIndex(Math.max(0, Math.min(p.pageCount - 1, d.lastPage ?? 0)));
        setMode(d.lastMode ?? "scroll");
        setRedMode(d.redMode ?? (d.sheetOn === false ? "off" : "mask"));
        if (d.sheetBand) setBand(d.sheetBand);
        setRevealed(new Set(d.revealed ?? []));
        setStarred(new Set(d.starred ?? []));
        bookIdRef.current = d.bookId;
        // ★・しおり sync as LWW-element-sets (改修案 §4.2): per-key tombstones so a delete on one
        // device isn't undone by another's stale set. Seed the maps (stamped "now", so existing local
        // picks survive migration) for pre-§4.2 decks that only have the starred-ids / bookmark table.
        const seedAt = Date.now();
        let starMap: StarMap = d.starsLww ?? {};
        let bmMap: BmMap = d.bmLww ?? {};
        // The ★ key scheme changed from ordinal to position (§4.4); an old map has 2-part keys
        // ("5:1") that won't resolve. Treat such a map as legacy and rebuild it from the reliable
        // local id set (d.starred) so existing ★ survive the upgrade instead of being cleared.
        const starLegacy = Object.keys(starMap).some((k) => k.split(":").length < 3);
        if (!d.starsLww || starLegacy || !d.bmLww) {
          const byPage = new Map<number, CardRow[]>();
          for (const c of await deckCards(deckId)) {
            const arr = byPage.get(c.pageIndex) ?? [];
            arr.push(c);
            byPage.set(c.pageIndex, arr);
          }
          const { idToKey } = cardKeyMaps(byPage);
          if (!d.starsLww || starLegacy) {
            starMap = {};
            setActiveStars(
              starMap,
              (d.starred ?? []).map((i) => idToKey.get(i)).filter((x): x is string => !!x),
              seedAt,
            );
          }
          if (!d.bmLww)
            for (const b of await listBookmarks(deckId)) addBm(bmMap, b.title, b.pageIndex, seedAt);
        }
        // Pro cross-device progress: MERGE the cloud blob into our local one (position by posAt;
        // ★・しおり per-key LWW). Fail-open: signed-out / offline keeps local.
        if (useAuth.getState().user && d.bookId) {
          const cloud = await getProgress(d.bookId).catch(() => null);
          if (!cancelled && cloud) {
            const localNorm = normalize(
              {
                lastPage: d.lastPage,
                lastMode: d.lastMode,
                redMode: d.redMode,
                sheetBand: d.sheetBand,
                revealedKeys: undefined, // revealed stays whole-set; pending effect already restores it
                posAt: d.progressAt ?? 0,
                starsLww: starMap,
                bmLww: bmMap,
              },
              seedAt,
            );
            const merged = mergeBlobs(localNorm, normalize(cloud.data, cloud.updatedAt));
            starMap = merged.starsLww ?? {};
            bmMap = merged.bmLww ?? {};
            if (typeof merged.lastPage === "number")
              setPageIndex(Math.max(0, Math.min(p.pageCount - 1, merged.lastPage)));
            if (merged.lastMode) setMode(merged.lastMode);
            if (merged.redMode) setRedMode(merged.redMode);
            if (merged.sheetBand) setBand(merged.sheetBand);
            // revealed rides the position group (whole-set LWW). Adopt cloud's ONLY when cloud's
            // position is newer; otherwise keep this device's revealed (restored from d.revealed
            // above) — adopting an older cloud set would wipe newer local reveals.
            if ((cloud.data.posAt ?? 0) > (d.progressAt ?? 0))
              setPendingRevealKeys(cloud.data.revealedKeys ?? []); // applied once cards load
            setPendingStarKeys(activeStarKeys(merged)); // ditto (portable keys -> local ids)
            void replaceBookmarks(deckId, activeBookmarks(merged)).catch(() => {}); // merged しおり
            void updateDeck(deckId, {
              lastPage: merged.lastPage,
              lastMode: merged.lastMode,
              redMode: merged.redMode,
              sheetBand: merged.sheetBand,
              progressAt: merged.posAt,
              starsLww: starMap,
              bmLww: bmMap,
            });
          } else if (!cancelled) {
            void updateDeck(deckId, { starsLww: starMap, bmLww: bmMap }); // persist seeded maps
          }
        } else {
          void updateDeck(deckId, { starsLww: starMap, bmLww: bmMap });
        }
        starMapRef.current = starMap;
        bmMapRef.current = bmMap;
        // Pro: pull newer masks from the cloud (last-write-wins; fail-open). Replaces cards in Dexie,
        // so the allCards live query re-renders the viewer with masks added/removed on another device.
        if (useAuth.getState().user && d.bookId) await refreshContent(deckId).catch(() => {});
        if (cancelled) return;
        setDocReady(true);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setErrMsg(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      const doc = docRef.current;
      docRef.current = null;
      void doc?.loadingTask.destroy();
    };
  }, [deckId]);

  // Apply cloud reveal keys once this book's cards have loaded (maps portable keys -> local ids).
  useEffect(() => {
    if (!pendingRevealKeys || !allCards || allCards.length === 0) return;
    const { keyToId } = cardKeyMaps(cardsByPage);
    const ids = pendingRevealKeys.map((k) => keyToId.get(k)).filter((x): x is number => x != null);
    // Don't let a non-empty but fully-unresolvable cloud set (e.g. legacy ordinal keys after the §4.4
    // key change) wipe local reveals — keep what's local and let the next push re-key it.
    if (pendingRevealKeys.length > 0 && ids.length === 0) {
      setPendingRevealKeys(null);
      return;
    }
    setRevealed(new Set(ids));
    void updateDeck(deckId, { revealed: ids });
    setPendingRevealKeys(null);
  }, [pendingRevealKeys, allCards, cardsByPage, deckId]);

  // Apply cloud star keys once this book's cards have loaded (maps portable keys -> local ids).
  useEffect(() => {
    if (!pendingStarKeys || !allCards || allCards.length === 0) return;
    const { keyToId } = cardKeyMaps(cardsByPage);
    const ids = pendingStarKeys.map((k) => keyToId.get(k)).filter((x): x is number => x != null);
    setStarred(new Set(ids));
    void updateDeck(deckId, { starred: ids });
    setPendingStarKeys(null);
  }, [pendingStarKeys, allCards, cardsByPage, deckId]);

  const pageCount = pdf?.pageCount ?? 1;
  const percent = pageCount > 0 ? Math.round(((pageIndex + 1) / pageCount) * 100) : 0;
  const goTo = (p: number) => setPageIndex(Math.max(0, Math.min(pageCount - 1, p)));
  const jumpToPage = (p: number) => {
    goTo(p);
    setJumpNonce((n) => n + 1); // tells ContinuousView to scroll there
  };

  // Remember the reading position + mode (debounced while reading + on exit).
  useEffect(() => {
    if (status !== "ready") return;
    const id = setTimeout(() => void updateDeck(deckId, { lastPage: pageIndex, lastMode: mode }), 700);
    return () => clearTimeout(id);
  }, [pageIndex, mode, status, deckId]);
  // Persist the red-sheet reveal state so reopening the book restores what was shown/hidden.
  useEffect(() => {
    if (status !== "ready") return;
    const id = setTimeout(
      () => void updateDeck(deckId, { revealed: [...revealed], redMode, sheetBand: band }),
      500,
    );
    return () => clearTimeout(id);
  }, [revealed, redMode, band, status, deckId]);
  // Pro cross-device progress: push reading state + revealed (as portable keys) to the cloud
  // (debounced). Skip while a cloud pull is still pending, so we don't overwrite it with stale local.
  useEffect(() => {
    if (status !== "ready" || !user || !bookIdRef.current || pendingRevealKeys || pendingStarKeys)
      return;
    const id = setTimeout(() => {
      const { idToKey } = cardKeyMaps(cardsByPage);
      const toKeys = (ids: Iterable<number>) =>
        [...ids].map((i) => idToKey.get(i)).filter((x): x is string => !!x);
      // Reconcile the ★・しおり maps toward the current live sets (per-key add/tombstone), then push
      // the maps + posAt. The server merges per-key (§4.2), so this never clobbers another device.
      const now = Date.now();
      setActiveStars(starMapRef.current, toKeys(starred), now);
      setActiveBookmarks(
        bmMapRef.current,
        bookmarks.map((b) => ({ title: b.title, pageIndex: b.pageIndex })),
        now,
      );
      void updateDeck(deckId, {
        progressAt: now,
        starsLww: starMapRef.current,
        bmLww: bmMapRef.current,
      });
      void putProgress(bookIdRef.current!, {
        lastPage: pageIndex,
        lastMode: mode,
        redMode,
        sheetBand: band,
        revealedKeys: toKeys(revealed),
        posAt: now,
        starsLww: starMapRef.current,
        bmLww: bmMapRef.current,
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(id);
  }, [pageIndex, mode, redMode, band, revealed, starred, bookmarks, status, deckId, user, pendingRevealKeys, pendingStarKeys, cardsByPage]);
  const exit = () => {
    if (status === "ready") {
      void updateDeck(deckId, {
        lastPage: pageIndex,
        lastMode: mode,
        revealed: [...revealed],
        redMode,
        sheetBand: band,
      });
      if (user && bookIdRef.current) {
        const { idToKey } = cardKeyMaps(cardsByPage);
        const toKeys = (ids: Iterable<number>) =>
          [...ids].map((i) => idToKey.get(i)).filter((x): x is string => !!x);
        const now = Date.now();
        setActiveStars(starMapRef.current, toKeys(starred), now);
        setActiveBookmarks(
          bmMapRef.current,
          bookmarks.map((b) => ({ title: b.title, pageIndex: b.pageIndex })),
          now,
        );
        void updateDeck(deckId, { starsLww: starMapRef.current, bmLww: bmMapRef.current });
        void putProgress(bookIdRef.current, {
          lastPage: pageIndex,
          lastMode: mode,
          redMode,
          sheetBand: band,
          revealedKeys: toKeys(revealed),
          posAt: now,
          starsLww: starMapRef.current,
          bmLww: bmMapRef.current,
        }).catch(() => {});
      }

    }
    setView({ name: "decks" });
  };
  // +/− step by 10% (snapped to the 10% grid so it stays clean after a wheel zoom).
  const stepZoom = (dir: 1 | -1) =>
    setZoom((z) => clampZoom(Math.round(z * 10) / 10 + dir * ZOOM_STEP));
  // Trackpad / ctrl+wheel zoom: multiply continuously, clamped.
  const onPinchZoom = useCallback((factor: number) => setZoom((z) => clampZoom(z * factor)), []);
  // Manual percentage entry: hold the raw text while editing, apply on Enter/blur.
  const applyZoomInput = () => {
    if (zoomEdit == null) return;
    const v = parseFloat(zoomEdit);
    if (!Number.isNaN(v)) setZoom(clampZoom(v / 100));
    setZoomEdit(null);
  };
  const toggle = (id: number) =>
    setRevealed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Long-press a mask to star/unstar its answer (persisted immediately so review mode is stable).
  const onStar = useCallback(
    (id: number) =>
      setStarred((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        void updateDeck(deckId, { starred: [...n] });
        return n;
      }),
    [deckId],
  );

  // 赤マスク and 赤シート are separate, mutually-exclusive toggles (tap the active one to turn
  // it off). 赤シート is 縦読み only.
  const selectMask = () => {
    setRedMode((m) => (m === "mask" ? "off" : "mask"));
    setRevealed(new Set());
  };
  const selectSheet = () => {
    setRedMode((m) => (m === "sheet" ? "off" : "sheet"));
    setRevealed(new Set());
  };

  // Keyboard: Space toggles the sheet, +/- zoom; in paged mode ←/→/Home/End navigate.
  const kref = useRef({ active: false, mode, goTo, stepZoom, toggle: () => {}, pageIndex, pageCount });
  kref.current = {
    active: status === "ready",
    mode,
    goTo,
    stepZoom,
    toggle: () => {
      setRedMode((m) => (m === "mask" ? "off" : "mask"));
      setRevealed(new Set());
    },
    pageIndex,
    pageCount,
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = kref.current;
      if (!k.active || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (k.mode === "paged" && e.key === "ArrowLeft") k.goTo(k.pageIndex - 1);
      else if (k.mode === "paged" && e.key === "ArrowRight") k.goTo(k.pageIndex + 1);
      else if (k.mode === "paged" && e.key === "Home") k.goTo(0);
      else if (k.mode === "paged" && e.key === "End") k.goTo(k.pageCount - 1);
      else if (e.key === "+" || e.key === "=") k.stepZoom(1);
      else if (e.key === "-") k.stepZoom(-1);
      else if (e.key === " ") {
        e.preventDefault();
        k.toggle();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (status === "loading") return <div className="centered">読み込み中…</div>;
  if (status === "error")
    return (
      <div className="centered">
        <p>エラー: {errMsg}</p>
        <button className="btn" onClick={() => setView({ name: "decks" })}>
          戻る
        </button>
      </div>
    );

  const doc = docRef.current;
  const currentCards = cardsByPage.get(pageIndex) ?? [];
  // ★復習 mode masks only the starred answers (review just those); the rest stay revealed.
  const shownCards = starMode ? currentCards.filter((c) => starred.has(c.id!)) : currentCards;
  // Sheet OFF = show everything: render no mask layer (no dead clicks, clean state).
  const groups: MaskGroup[] = sheetOn
    ? shownCards.map((c) => ({ id: c.id!, rects: c.rects.length ? c.rects : [c.answerRect] }))
    : [];
  // Staged edits applied to the current page: base masks (minus pending deletes) + pending adds.
  // Pending adds carry a negative temp id so tapping one just removes it from the buffer.
  const editDirty = editAdds.length > 0 || editDels.size > 0;
  const editGroups: MaskGroup[] = [
    ...currentCards
      .filter((c) => !editDels.has(c.id!))
      .map((c) => ({ id: c.id!, rects: c.rects.length ? c.rects : [c.answerRect] })),
    ...editAdds
      .filter((a) => a.pageIndex === pageIndex)
      .map((a) => ({ id: a.tempId, rects: [a.rect] })),
  ];
  // For 縦読み editing: overlay the staged buffer onto the per-page cards (base minus pending
  // deletes, plus pending adds as pseudo cards) so ContinuousView shows the in-progress edits.
  let displayCardsByPage = cardsByPage;
  if (editMode) {
    const m = new Map<number, CardRow[]>();
    for (const [page, cards] of cardsByPage) m.set(page, cards.filter((c) => !editDels.has(c.id!)));
    for (const a of editAdds) {
      const arr = m.get(a.pageIndex) ?? [];
      arr.push({
        id: a.tempId,
        deckId,
        pdfId: 0,
        pageIndex: a.pageIndex,
        rects: [a.rect],
        answerRect: a.rect,
        text: "",
        createdAt: 0,
      });
      m.set(a.pageIndex, arr);
    }
    displayCardsByPage = m;
  } else if (starMode) {
    const m = new Map<number, CardRow[]>();
    for (const [pg, cards] of cardsByPage) m.set(pg, cards.filter((c) => starred.has(c.id!)));
    displayCardsByPage = m;
  }
  // Each edit pushes the current buffer onto the history stack first, so アンドゥ can restore it.
  const applyEdit = (nextAdds: EditAdd[], nextDels: Set<number>) => {
    setHistory((h) => [...h, { adds: editAdds, dels: editDels }]);
    setEditAdds(nextAdds);
    setEditDels(nextDels);
  };
  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setEditAdds(prev.adds);
    setEditDels(prev.dels);
    setHistory(history.slice(0, -1));
  };
  const onDeleteMask = (id: string | number) => {
    const n = id as number;
    if (n < 0) applyEdit(editAdds.filter((x) => x.tempId !== n), editDels);
    else applyEdit(editAdds, new Set(editDels).add(n));
  };
  // The drawn rectangle (page coords): "add" → a new mask; "delete" → remove every mask (saved or
  // staged) on this page that it overlaps (範囲一括削除).
  const onDrawRect = (rect: Rect, page: number) => {
    if (drawMode === "delete") {
      const dels = new Set(editDels);
      for (const c of cardsByPage.get(page) ?? []) {
        const rs = c.rects.length ? c.rects : [c.answerRect];
        if (!editDels.has(c.id!) && rs.some((r) => rectsOverlap(r, rect))) dels.add(c.id!);
      }
      const adds = editAdds.filter((a) => !(a.pageIndex === page && rectsOverlap(a.rect, rect)));
      applyEdit(adds, dels);
    } else {
      applyEdit([...editAdds, { tempId: tempIdRef.current--, pageIndex: page, rect }], editDels);
    }
    setDrawMode(null);
  };
  const discardEdits = () => {
    setEditAdds([]);
    setEditDels(new Set());
    setHistory([]);
    setDrawMode(null);
  };
  const saveEdit = async () => {
    if (pdf?.id != null) {
      for (const id of editDels) await deleteCard(id);
      for (const a of editAdds) await addCard(deckId, pdf.id, a.pageIndex, a.rect);
      // Pro: re-sync the content JSON so added/removed masks reach the user's other devices
      // (best-effort, fail-open; the PDF is unchanged so no blob re-upload).
      if (useAuth.getState().user) {
        const d = await getDeck(deckId);
        if (d?.bookId) void uploadContent(d.bookId, deckId).catch(() => {});
      }
    }
    discardEdits();
    setEditMode(false);
  };
  const cancelEdit = () => {
    discardEdits();
    setEditMode(false);
  };
  // Exit / navigate with unsaved edits → confirm discarding them first.
  const guardEdit = (action: () => void) => {
    if (editMode && editDirty && !window.confirm("保存していない編集があります。破棄しますか？")) return;
    if (editMode && editDirty) discardEdits();
    action();
  };

  const addCurrentBookmark = async () => {
    const title = window.prompt("しおりの名前（章・節など）", `${pageIndex + 1}ページ`);
    if (title && title.trim()) await addBookmark(deckId, pageIndex, title.trim());
  };
  const renameBookmarkAt = async (b: BookmarkRow) => {
    const title = window.prompt("しおりの名前", b.title);
    if (title && title.trim()) await renameBookmark(b.id!, title.trim());
  };

  const ready = doc && docReady && pdf;

  return (
    <div className="viewer" ref={viewerRef}>
      <div className="review-bar">
        <button className="btn ghost sm" onClick={() => guardEdit(exit)}>
          終了
        </button>
        <button className="btn ghost sm" onClick={() => setTocOpen(true)}>
          目次
        </button>
        <button className="btn ghost sm" onClick={() => setView({ name: "quiz", deckId })}>
          問題
        </button>
        <span className="book-title-bar" title={deckName}>
          {deckName}
        </span>
        {!editMode && (
          <>
            <button
              className={`btn sm ${redMode === "mask" ? "primary" : "ghost"}`}
              onClick={selectMask}
            >
              赤マスク
            </button>
            {mode === "scroll" && (
              <button
                className={`btn sm ${redMode === "sheet" ? "primary" : "ghost"}`}
                onClick={selectSheet}
              >
                赤シート
              </button>
            )}
            <button
              className={`btn sm ${starMode ? "primary" : "ghost"}`}
              onClick={() => setStarMode((v) => !v)}
              title="★を付けた答えだけを隠して復習"
            >
              ★復習
            </button>
            <button
              className="btn ghost sm"
              onClick={() => {
                setEditMode(true);
                setDrawMode(null);
              }}
            >
              編集
            </button>
          </>
        )}
      </div>

      {editMode && (
        <div className="edit-bar">
          <span className="muted small">
            タップで個別削除／ドラッグで「追加」または「範囲削除」
          </span>
          <button
            className={`btn sm ${drawMode === "add" ? "primary" : ""}`}
            onClick={() => setDrawMode((m) => (m === "add" ? null : "add"))}
          >
            {drawMode === "add" ? "囲んでください…（取消）" : "＋ マスク追加"}
          </button>
          <button
            className={`btn sm ${drawMode === "delete" ? "primary" : ""}`}
            onClick={() => setDrawMode((m) => (m === "delete" ? null : "delete"))}
          >
            {drawMode === "delete" ? "囲んでください…（取消）" : "範囲削除"}
          </button>
          <button className="btn ghost sm" onClick={undo} disabled={history.length === 0}>
            ↶ アンドゥ
          </button>
          <span className="edit-bar-spacer" />
          <button className="btn ghost sm" onClick={cancelEdit}>
            編集をキャンセル
          </button>
          <button className="btn primary sm" onClick={() => void saveEdit()}>
            編集を保存
          </button>
        </div>
      )}

      {ready && mode === "paged" && (
        <PageOverlay
          doc={doc}
          pageIndex={pageIndex}
          pageW={pdf.pageW}
          pageH={pdf.pageH}
          groups={editMode ? editGroups : groups}
          revealedIds={revealed}
          onToggle={(id) => toggle(id as number)}
          fitMode={fitMode}
          zoom={zoom}
          onPinchZoom={onPinchZoom}
          maxWidth={1600}
          editMode={editMode}
          drawArm={drawMode !== null}
          drawKind={drawMode ?? "add"}
          onDrawRect={onDrawRect}
          onDeleteMask={onDeleteMask}
          starredIds={starred}
          onStar={(id) => onStar(id as number)}
        />
      )}
      {ready && mode === "scroll" && (
        <div className="sheet-host" ref={sheetHostRef}>
          <ContinuousView
            doc={doc}
            pageCount={pageCount}
            pageW={pdf.pageW}
            pageH={pdf.pageH}
            cardsByPage={displayCardsByPage}
            sheetOn={editMode ? true : sheetOn}
            revealed={revealed}
            onToggle={toggle}
            zoom={zoom}
            fitMode={fitMode}
            jumpTo={pageIndex}
            jumpNonce={jumpNonce}
            onVisiblePage={setPageIndex}
            onPinchZoom={onPinchZoom}
            manualSheet={editMode ? false : redMode === "sheet"}
            bandTop={band.top}
            editMode={editMode}
            drawMode={drawMode}
            onDeleteMask={onDeleteMask}
            onDrawRect={onDrawRect}
            starred={starred}
            onStar={onStar}
          />
          {redMode === "sheet" && !editMode && (
            <RedSheet band={band} onChange={setBand} hostRef={sheetHostRef} />
          )}
        </div>
      )}

      <div className="viewer-controls">
        <button className="btn sm" onClick={() => stepZoom(-1)} disabled={zoom <= MIN_ZOOM + 1e-3}>
          －
        </button>
        <span className="zoom-field">
          <input
            type="number"
            className="zoom-input"
            inputMode="numeric"
            min={Math.round(MIN_ZOOM * 100)}
            max={Math.round(MAX_ZOOM * 100)}
            step={Math.round(ZOOM_STEP * 100)}
            value={zoomEdit ?? Math.round(zoom * 100)}
            onChange={(e) => setZoomEdit(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={applyZoomInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                applyZoomInput();
                e.currentTarget.blur();
              }
            }}
            aria-label="拡大率（パーセント）"
          />
          <span className="zoom-suffix">%</span>
        </span>
        <button className="btn sm" onClick={() => stepZoom(1)} disabled={zoom >= MAX_ZOOM - 1e-3}>
          ＋
        </button>
        <button
          className="btn ghost sm"
          onClick={() => setZoom(1)}
          disabled={Math.abs(zoom - 1) < 1e-3}
          title="100% に戻す"
        >
          100%
        </button>
        <button
          className="btn ghost sm"
          onClick={() => setMode((m) => (m === "paged" ? "scroll" : "paged"))}
        >
          {mode === "paged" ? "縦読み" : "横読み"}
        </button>
        {fullscreenSupported && (
          <button className="btn ghost sm" onClick={toggleFullscreen}>
            {isFullscreen ? "⤢ 解除" : "⛶ 全画面"}
          </button>
        )}
        {mode === "paged" && (
          <>
            <button
              className="btn sm"
              disabled={pageIndex <= 0}
              onClick={() => guardEdit(() => goTo(pageIndex - 1))}
            >
              ← 前
            </button>
            <input
              type="range"
              className="page-slider"
              min={1}
              max={pageCount}
              value={pageIndex + 1}
              disabled={editMode}
              onChange={(e) => goTo(Number(e.target.value) - 1)}
            />
            <input
              type="number"
              className="page-input"
              min={1}
              max={pageCount}
              value={pageIndex + 1}
              disabled={editMode}
              onChange={(e) => goTo(Number(e.target.value) - 1)}
            />
            <button
              className="btn sm"
              disabled={pageIndex >= pageCount - 1}
              onClick={() => guardEdit(() => goTo(pageIndex + 1))}
            >
              次 →
            </button>
          </>
        )}
        <span className="page-status">
          {pageIndex + 1} / {pageCount}
          <span className="page-pct">{percent}%</span>
        </span>
      </div>

      {tocOpen && (
        <div className="drawer-backdrop" onClick={() => setTocOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3>目次（しおり）</h3>
              <button className="btn ghost sm" onClick={() => setTocOpen(false)}>
                閉じる
              </button>
            </div>
            <button className="btn primary sm" onClick={addCurrentBookmark}>
              ＋ 現在のページ（p.{pageIndex + 1}）をしおりに追加
            </button>
            {bookmarks.length === 0 && (
              <p className="muted small">
                まだしおりがありません。章の先頭ページで「追加」すると、ここから移動できます。
              </p>
            )}
            <ul className="toc-list">
              {bookmarks.map((b) => (
                <li key={b.id} className="toc-item">
                  <button
                    className="toc-jump"
                    onClick={() =>
                      guardEdit(() => {
                        jumpToPage(b.pageIndex);
                        setTocOpen(false);
                      })
                    }
                  >
                    <span className="toc-title">{b.title}</span>
                    <span className="toc-page">p.{b.pageIndex + 1}</span>
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => renameBookmarkAt(b)}
                    aria-label="名前を変更"
                  >
                    ✎
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => deleteBookmark(b.id!)}
                    aria-label="削除"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
