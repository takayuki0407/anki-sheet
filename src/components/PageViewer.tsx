import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { cardsOnPage, getDeck, getDeckPdf } from "../db/repo";
import { loadPdf } from "../pdf/pdfEngine";
import { PageOverlay, type MaskGroup } from "../render/PageOverlay";
import { useApp } from "../store/session";
import type { PdfRow } from "../types";

type Status = "loading" | "ready" | "error";

/** Standalone digital red sheet: flip through pages, hide/show all answers, tap to peek. */
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

  // Keyboard: ← / → flip pages, Space toggles the red sheet.
  const kc = pdf?.pageCount ?? 1;
  const vkey = {
    active: status === "ready",
    prev: () => setPageIndex((p) => Math.max(0, p - 1)),
    next: () => setPageIndex((p) => Math.min(kc - 1, p + 1)),
    toggle: () => setSheetOn((v) => !v),
  };
  const vkeyRef = useRef(vkey);
  vkeyRef.current = vkey;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = vkeyRef.current;
      if (!k.active) return;
      if (e.key === "ArrowLeft") k.prev();
      else if (e.key === "ArrowRight") k.next();
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
  const pageCount = pdf?.pageCount ?? 1;
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

  return (
    <div className="viewer">
      <div className="review-bar">
        <button className="btn ghost sm" onClick={() => setView({ name: "decks" })}>
          終了
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
        />
      )}

      <div className="viewer-nav">
        <button
          className="btn"
          disabled={pageIndex <= 0}
          onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
        >
          ← 前
        </button>
        <span className="muted">{groups.length} 個の答え</span>
        <button
          className="btn"
          disabled={pageIndex >= pageCount - 1}
          onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
        >
          次 →
        </button>
      </div>
    </div>
  );
}
