import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage } from "../pdf/pdfEngine";
import type { FitMode } from "../render/PageOverlay";
import type { CardRow } from "../types";

const MAX_DEVICE_W = 2800;
const BUFFER = "1200px 0px"; // pre-render pages within this distance of the viewport

interface Props {
  doc: PDFDocumentProxy;
  pageCount: number;
  pageW: number;
  pageH: number;
  cardsByPage: Map<number, CardRow[]>;
  sheetOn: boolean;
  revealed: ReadonlySet<number>;
  onToggle: (id: number) => void;
  zoom: number;
  /** "page" = each page fits the viewport (one page per screen); "width" = fit width. */
  fitMode: FitMode;
  /** Scroll to this page when jumpNonce changes (目次 / jump / mode switch). */
  jumpTo?: number;
  jumpNonce?: number;
}

/**
 * Continuous vertical reader: all pages stacked, scrolled top-to-bottom. Pages are
 * virtualized — only those near the viewport render a canvas (others are sized
 * placeholders), so a 252-page book stays light on memory.
 *
 * NOTE: slot heights use page 1's aspect ratio; mixed-page-size PDFs (rare here)
 * would have slightly off placeholders. Jumps scroll to the actual slot element,
 * so they stay correct w.r.t. margins/padding regardless.
 */
export function ContinuousView({
  doc,
  pageCount,
  pageW,
  pageH,
  cardsByPage,
  sheetOn,
  revealed,
  onToggle,
  zoom,
  fitMode,
  jumpTo,
  jumpNonce,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const appliedNonce = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () =>
      setDims((prev) => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        return Math.abs(prev.w - w) > 1 || Math.abs(prev.h - h) > 1 ? { w, h } : prev;
      });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // "page" fit sizes each page so the whole page fits the viewport (one per screen);
  // "width" fits the page width. Zoom multiplies from there.
  const aspect = pageH > 0 ? pageW / pageH : 0.7;
  const fitBaseW =
    fitMode === "page" && dims.h > 0
      ? Math.min(dims.w, dims.h * aspect)
      : Math.min(dims.w, 1100);
  const cssW = fitBaseW * zoom;

  // Scroll to a requested page once the container is measured. Re-runs when cssW
  // becomes available (handles cssW=0 on first mount); ignores zoom-only changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (jumpTo == null || !cssW || !el || appliedNonce.current === jumpNonce) return;
    const slot = el.querySelector<HTMLElement>(`[data-page="${jumpTo}"]`);
    if (slot) {
      el.scrollTop = slot.offsetTop;
      appliedNonce.current = jumpNonce;
    }
  }, [jumpNonce, cssW, jumpTo]);

  return (
    <div className="continuous-scroll" ref={scrollRef}>
      {cssW > 0 &&
        Array.from({ length: pageCount }, (_, i) => (
          <PageSlot
            key={i}
            doc={doc}
            pageIndex={i}
            cssW={cssW}
            pageW={pageW}
            pageH={pageH}
            cards={cardsByPage.get(i) ?? []}
            sheetOn={sheetOn}
            revealed={revealed}
            onToggle={onToggle}
            rootRef={scrollRef}
          />
        ))}
    </div>
  );
}

interface SlotProps {
  doc: PDFDocumentProxy;
  pageIndex: number;
  cssW: number;
  pageW: number;
  pageH: number;
  cards: CardRow[];
  sheetOn: boolean;
  revealed: ReadonlySet<number>;
  onToggle: (id: number) => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
}

function PageSlot({
  doc,
  pageIndex,
  cssW,
  pageW,
  pageH,
  cards,
  sheetOn,
  revealed,
  onToggle,
  rootRef,
}: SlotProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderToken = useRef(0);
  const [active, setActive] = useState(false);
  const height = (cssW * pageH) / pageW;
  const fitScale = cssW > 0 ? cssW / pageW : 0;

  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => setActive(e.isIntersecting)),
      { root: rootRef.current, rootMargin: BUFFER },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !cssW || !canvas) return;
    const token = ++renderToken.current;
    let cancelled = false;
    const stale = () => cancelled || token !== renderToken.current;
    (async () => {
      const dpr = window.devicePixelRatio || 1;
      const renderScale = Math.min((cssW / pageW) * dpr, MAX_DEVICE_W / pageW);
      const page = await doc.getPage(pageIndex + 1);
      if (stale()) {
        page.cleanup();
        return;
      }
      await renderPage(page, renderScale, canvas, stale);
      page.cleanup();
      if (!stale()) {
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${height}px`;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, cssW, doc, pageIndex, pageW, height]);

  // Free the backing store when the page scrolls far away (canvas stays mounted).
  useEffect(() => {
    if (active) return;
    const c = canvasRef.current;
    if (c) {
      c.width = 0;
      c.height = 0;
      c.style.width = "0px";
      c.style.height = "0px";
    }
  }, [active]);

  return (
    <div className="page-slot" ref={slotRef} data-page={pageIndex} style={{ width: cssW, height }}>
      <canvas ref={canvasRef} className="page-canvas" />
      {active &&
        sheetOn &&
        fitScale > 0 &&
        cards.flatMap((c) => {
          const rects = c.rects.length ? c.rects : [c.answerRect];
          const isRevealed = revealed.has(c.id!);
          return rects.map((r, i) => (
            <div
              key={`${c.id}:${i}`}
              className={isRevealed ? "reveal-zone" : "mask"}
              style={{
                left: r.x * fitScale,
                top: r.y * fitScale,
                width: r.w * fitScale,
                height: r.h * fitScale,
              }}
              onClick={() => onToggle(c.id!)}
            />
          ));
        })}
    </div>
  );
}
