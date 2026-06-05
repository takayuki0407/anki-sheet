import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  addBookmark,
  cardsOnPage,
  deleteBookmark,
  getDeck,
  getDeckPdf,
  listBookmarks,
} from "../db/repo";
import { loadPdf } from "../pdf/pdfEngine";
import { PageOverlay, type MaskGroup } from "../render/PageOverlay";
import { useApp } from "../store/session";
import type { PdfRow } from "../types";

type Status = "loading" | "ready" | "error";
const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3];

/** Standalone digital red sheet: page through a PDF, hide/show answers, tap to peek. */
export function PageViewer({ deckId }: { deckId: number }) {
  const setView = useApp((s) => s.setView);
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [pdf, setPdf] = useState<PdfRow>();
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const [docReady, setDocReady] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [sheetOn, setSheetOn] = useState(true);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [tocOpen, setTocOpen] = useState(false);

  const bookmarks = useLiveQuery(() => listBookmarks(deckId), [deckId]) ?? [];

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
        setPageIndex(0);
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

  useEffect(() => {
    setRevealed(new Set());
  }, [pageIndex]);

  const cards = useLiveQuery(
    () => (status === "ready" ? cardsOnPage(deckId, pageIndex) : Promise.resolve([])),
    [deckId, pageIndex, status],
  );

  const pageCount = pdf?.pageCount ?? 1;
  const goTo = (p: number) => setPageIndex(Math.max(0, Math.min(pageCount - 1, p)));
  const stepZoom = (dir: 1 | -1) => {
    const i = ZOOMS.indexOf(zoom);
    const ni = Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 0 : i) + dir));
    setZoom(ZOOMS[ni]);
  };

  // Keyboard: ←/→ pages, Space toggles the sheet, +/- zoom, Home/End first/last.
  const kref = useRef({ active: false, goTo, stepZoom, toggle: () => {}, pageIndex, pageCount });
  kref.current = {
    active: status === "ready",
    goTo,
    stepZoom,
    toggle: () => setSheetOn((v) => !v),
    pageIndex,
    pageCount,
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = kref.current;
      if (!k.active || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowLeft") k.goTo(k.pageIndex - 1);
      else if (e.key === "ArrowRight") k.goTo(k.pageIndex + 1);
      else if (e.key === "Home") k.goTo(0);
      else if (e.key === "End") k.goTo(k.pageCount - 1);
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
  const groups: MaskGroup[] = (cards ?? []).map((c) => ({
    id: c.id!,
    rects: c.rects.length ? c.rects : [c.answerRect],
  }));
  const allIds = new Set<string | number>(groups.map((g) => g.id));
  const revealedIds: ReadonlySet<string | number> = sheetOn ? revealed : allIds;
  const toggle = (id: string | number) =>
    setRevealed((s) => {
      const n = new Set(s);
      if (n.has(id as number)) n.delete(id as number);
      else n.add(id as number);
      return n;
    });

  const addCurrentBookmark = async () => {
    const title = window.prompt("しおりの名前（章・節など）", `${pageIndex + 1}ページ`);
    if (title && title.trim()) await addBookmark(deckId, pageIndex, title.trim());
  };

  return (
    <div className="viewer">
      <div className="review-bar">
        <button className="btn ghost sm" onClick={() => setView({ name: "decks" })}>
          終了
        </button>
        <button className="btn ghost sm" onClick={() => setTocOpen(true)}>
          目次
        </button>
        <span className="review-progress">
          {pageIndex + 1} / {pageCount}
        </span>
        <button
          className={`btn sm ${sheetOn ? "primary" : "ghost"}`}
          onClick={() => setSheetOn((v) => !v)}
        >
          赤シート {sheetOn ? "ON" : "OFF"}
        </button>
      </div>

      {doc && docReady && pdf && (
        <PageOverlay
          doc={doc}
          pageIndex={pageIndex}
          pageW={pdf.pageW}
          groups={groups}
          revealedIds={revealedIds}
          onToggle={toggle}
          zoom={zoom}
          maxWidth={1400}
        />
      )}

      <div className="viewer-controls">
        <div className="zoom-row">
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
          <span className="muted spacer">{groups.length} 個の暗記</span>
        </div>
        <div className="nav-row">
          <button className="btn" disabled={pageIndex <= 0} onClick={() => goTo(pageIndex - 1)}>
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
            className="btn"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => goTo(pageIndex + 1)}
          >
            次 →
          </button>
        </div>
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
                      goTo(b.pageIndex);
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
