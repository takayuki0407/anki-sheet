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
  updateDeck,
} from "../db/repo";
import { loadPdf } from "../pdf/pdfEngine";
import { PageOverlay, type FitMode, type MaskGroup } from "../render/PageOverlay";
import { ContinuousView } from "./ContinuousView";
import { useApp } from "../store/session";
import { useAuth } from "../auth/useAuth";
import { getProgress, putProgress } from "../sync/api";
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
/** Device-portable reveal keys: a card's "pageIndex:ordinal", where ordinal is its index among
 *  the page's cards sorted by position (y,x) — identical across devices for the same detected
 *  book, so revealed answers map correctly despite local card ids differing per device. */
function cardKeyMaps(cardsByPage: Map<number, CardRow[]>) {
  const idToKey = new Map<number, string>();
  const keyToId = new Map<string, number>();
  for (const [page, cards] of cardsByPage) {
    [...cards]
      .sort((a, b) => a.answerRect.y - b.answerRect.y || a.answerRect.x - b.answerRect.x)
      .forEach((c, i) => {
        if (c.id != null) {
          const key = `${page}:${i}`;
          idToKey.set(c.id, key);
          keyToId.set(key, c.id);
        }
      });
  }
  return { idToKey, keyToId };
}

export function PageViewer({ deckId }: { deckId: number }) {
  const setView = useApp((s) => s.setView);
  const user = useAuth((s) => s.user);
  // Reveal keys pulled from the cloud, applied once the page's cards have loaded (see effect).
  const [pendingRevealKeys, setPendingRevealKeys] = useState<string[] | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [pdf, setPdf] = useState<PdfRow>();
  const [deckName, setDeckName] = useState("");
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const bookIdRef = useRef<string | undefined>(undefined); // for cross-device progress sync
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
  const [drawArm, setDrawArm] = useState(false);
  const [editAdds, setEditAdds] = useState<{ tempId: number; pageIndex: number; rect: Rect }[]>([]);
  const [editDels, setEditDels] = useState<Set<number>>(new Set());
  const tempIdRef = useRef(-1);

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
        bookIdRef.current = d.bookId;
        // Pro cross-device progress: if the cloud copy is newer, resume from it (reading position /
        // mode / red-sheet — device-independent fields; reveal state stays local for now).
        if (useAuth.getState().user && d.bookId) {
          const cloud = await getProgress(d.bookId).catch(() => null);
          if (!cancelled && cloud && cloud.updatedAt > (d.progressAt ?? 0)) {
            const { revealedKeys, ...c } = cloud.data;
            if (typeof c.lastPage === "number")
              setPageIndex(Math.max(0, Math.min(p.pageCount - 1, c.lastPage)));
            if (c.lastMode) setMode(c.lastMode);
            if (c.redMode) setRedMode(c.redMode);
            if (c.sheetBand) setBand(c.sheetBand);
            setPendingRevealKeys(revealedKeys ?? []); // applied once this book's cards have loaded
            void updateDeck(deckId, { ...c, progressAt: cloud.updatedAt });
          }
        }
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
    setRevealed(new Set(ids));
    void updateDeck(deckId, { revealed: ids });
    setPendingRevealKeys(null);
  }, [pendingRevealKeys, allCards, cardsByPage, deckId]);

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
    if (status !== "ready" || !user || !bookIdRef.current || pendingRevealKeys) return;
    const id = setTimeout(() => {
      const { idToKey } = cardKeyMaps(cardsByPage);
      const revealedKeys = [...revealed]
        .map((i) => idToKey.get(i))
        .filter((x): x is string => !!x);
      void updateDeck(deckId, { progressAt: Date.now() });
      void putProgress(bookIdRef.current!, {
        lastPage: pageIndex,
        lastMode: mode,
        redMode,
        sheetBand: band,
        revealedKeys,
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(id);
  }, [pageIndex, mode, redMode, band, revealed, status, deckId, user, pendingRevealKeys, cardsByPage]);
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
        void putProgress(bookIdRef.current, {
          lastPage: pageIndex,
          lastMode: mode,
          redMode,
          sheetBand: band,
          revealedKeys: [...revealed].map((i) => idToKey.get(i)).filter((x): x is string => !!x),
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
  // Sheet OFF = show everything: render no mask layer (no dead clicks, clean state).
  const groups: MaskGroup[] = sheetOn
    ? currentCards.map((c) => ({ id: c.id!, rects: c.rects.length ? c.rects : [c.answerRect] }))
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
  const onAddMask = (rect: Rect) => {
    setEditAdds((a) => [...a, { tempId: tempIdRef.current--, pageIndex, rect }]);
    setDrawArm(false);
  };
  const onDeleteMask = (id: string | number) => {
    const n = id as number;
    if (n < 0) setEditAdds((a) => a.filter((x) => x.tempId !== n));
    else setEditDels((s) => new Set(s).add(n));
  };
  const discardEdits = () => {
    setEditAdds([]);
    setEditDels(new Set());
    setDrawArm(false);
  };
  const saveEdit = async () => {
    if (pdf?.id != null) {
      for (const id of editDels) await deleteCard(id);
      for (const a of editAdds) await addCard(deckId, pdf.id, a.pageIndex, a.rect);
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
              className="btn ghost sm"
              onClick={() => {
                setEditMode(true);
                setDrawArm(false);
                setMode("paged"); // mask editing happens on the single paged view
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
            マスクをタップで削除／「マスク追加」を押してドラッグで囲むと追加（p.{pageIndex + 1}）
          </span>
          <button className={`btn sm ${drawArm ? "primary" : ""}`} onClick={() => setDrawArm((v) => !v)}>
            {drawArm ? "囲んでください…（取消）" : "＋ マスク追加"}
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
          onTapZone={(dir) => goTo(pageIndex + dir)}
          onPinchZoom={onPinchZoom}
          maxWidth={1600}
          editMode={editMode}
          drawArm={drawArm}
          onAddMask={onAddMask}
          onDeleteMask={onDeleteMask}
        />
      )}
      {ready && mode === "scroll" && (
        <div className="sheet-host" ref={sheetHostRef}>
          <ContinuousView
            doc={doc}
            pageCount={pageCount}
            pageW={pdf.pageW}
            pageH={pdf.pageH}
            cardsByPage={cardsByPage}
            sheetOn={sheetOn}
            revealed={revealed}
            onToggle={toggle}
            zoom={zoom}
            fitMode={fitMode}
            jumpTo={pageIndex}
            jumpNonce={jumpNonce}
            onVisiblePage={setPageIndex}
            onPinchZoom={onPinchZoom}
            manualSheet={redMode === "sheet"}
            bandTop={band.top}
          />
          {redMode === "sheet" && <RedSheet band={band} onChange={setBand} hostRef={sheetHostRef} />}
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
          disabled={editMode}
          title={editMode ? "編集中は横読み固定です" : undefined}
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
