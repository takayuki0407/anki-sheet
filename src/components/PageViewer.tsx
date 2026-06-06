import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  addBookmark,
  deckCards,
  deleteBookmark,
  getDeck,
  getDeckPdf,
  listBookmarks,
  updateDeck,
} from "../db/repo";
import { loadPdf } from "../pdf/pdfEngine";
import { PageOverlay, type FitMode, type MaskGroup } from "../render/PageOverlay";
import { ContinuousView } from "./ContinuousView";
import { useApp } from "../store/session";
import type { CardRow, PdfRow } from "../types";

type Status = "loading" | "ready" | "error";
type Mode = "paged" | "scroll";
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4];

/** Standalone digital red sheet: page through (or scroll) a PDF, hide/show answers. */
export function PageViewer({ deckId }: { deckId: number }) {
  const setView = useApp((s) => s.setView);
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [pdf, setPdf] = useState<PdfRow>();
  const [deckName, setDeckName] = useState("");
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const [docReady, setDocReady] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [sheetOn, setSheetOn] = useState(true);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>("page");
  const [mode, setMode] = useState<Mode>("scroll"); // 縦読み by default
  const [jumpNonce, setJumpNonce] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

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
        setSheetOn(true);
        setRevealed(new Set());
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
  const exit = () => {
    if (status === "ready") void updateDeck(deckId, { lastPage: pageIndex, lastMode: mode });
    setView({ name: "decks" });
  };
  const stepZoom = (dir: 1 | -1) => {
    const i = ZOOMS.indexOf(zoom);
    const ni = Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 0 : i) + dir));
    setZoom(ZOOMS[ni]);
  };
  const toggle = (id: number) =>
    setRevealed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Keyboard: Space toggles the sheet, +/- zoom; in paged mode ←/→/Home/End navigate.
  const kref = useRef({ active: false, mode, goTo, stepZoom, toggle: () => {}, pageIndex, pageCount });
  kref.current = {
    active: status === "ready",
    mode,
    goTo,
    stepZoom,
    toggle: () => {
      setSheetOn((v) => !v);
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

  const addCurrentBookmark = async () => {
    const title = window.prompt("しおりの名前（章・節など）", `${pageIndex + 1}ページ`);
    if (title && title.trim()) await addBookmark(deckId, pageIndex, title.trim());
  };

  const ready = doc && docReady && pdf;

  return (
    <div className="viewer" ref={viewerRef}>
      <div className="review-bar">
        <button className="btn ghost sm" onClick={exit}>
          終了
        </button>
        <button className="btn ghost sm" onClick={() => setTocOpen(true)}>
          目次
        </button>
        <span className="book-title-bar" title={deckName}>
          {deckName}
        </span>
        <button
          className={`btn sm ${sheetOn ? "primary" : "ghost"}`}
          onClick={() => {
            setSheetOn((v) => !v);
            setRevealed(new Set());
          }}
        >
          赤シート {sheetOn ? "ON" : "OFF"}
        </button>
      </div>

      {ready && mode === "paged" && (
        <PageOverlay
          doc={doc}
          pageIndex={pageIndex}
          pageW={pdf.pageW}
          pageH={pdf.pageH}
          groups={groups}
          revealedIds={revealed}
          onToggle={(id) => toggle(id as number)}
          fitMode={fitMode}
          zoom={zoom}
          onTapZone={(dir) => goTo(pageIndex + dir)}
          maxWidth={1600}
        />
      )}
      {ready && mode === "scroll" && (
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
        />
      )}

      <div className="viewer-controls">
        <button className="btn sm" onClick={() => stepZoom(-1)} disabled={zoom <= ZOOMS[0]}>
          －
        </button>
        <button className="btn ghost sm" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="btn sm"
          onClick={() => stepZoom(1)}
          disabled={zoom >= ZOOMS[ZOOMS.length - 1]}
        >
          ＋
        </button>
        <button
          className="btn ghost sm"
          onClick={() => setMode((m) => (m === "paged" ? "scroll" : "paged"))}
        >
          {mode === "paged" ? "縦読み" : "横読み"}
        </button>
        <button
          className="btn ghost sm"
          onClick={() => setFitMode((m) => (m === "page" ? "width" : "page"))}
        >
          {fitMode === "page" ? "幅に合わせる" : "全体表示"}
        </button>
        <button className="btn ghost sm" onClick={toggleFullscreen}>
          {isFullscreen ? "⤢ 解除" : "⛶ 全画面"}
        </button>
        {mode === "paged" && (
          <>
            <button className="btn sm" disabled={pageIndex <= 0} onClick={() => goTo(pageIndex - 1)}>
              ← 前
            </button>
            <input
              type="range"
              className="page-slider"
              min={1}
              max={pageCount}
              value={pageIndex + 1}
              onChange={(e) => goTo(Number(e.target.value) - 1)}
            />
            <input
              type="number"
              className="page-input"
              min={1}
              max={pageCount}
              value={pageIndex + 1}
              onChange={(e) => goTo(Number(e.target.value) - 1)}
            />
            <button
              className="btn sm"
              disabled={pageIndex >= pageCount - 1}
              onClick={() => goTo(pageIndex + 1)}
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
                    onClick={() => {
                      jumpToPage(b.pageIndex);
                      setTocOpen(false);
                    }}
                  >
                    <span className="toc-title">{b.title}</span>
                    <span className="toc-page">p.{b.pageIndex + 1}</span>
                  </button>
                  <button className="btn ghost sm" onClick={() => deleteBookmark(b.id!)}>
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
