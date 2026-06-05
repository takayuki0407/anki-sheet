import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage } from "../pdf/pdfEngine";
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
  /** Scroll to this page when jumpNonce changes (目次 / jump). */
  jumpTo?: number;
  jumpNonce?: number;
}

/**
 * Continuous vertical reader: all pages stacked, scrolled top-to-bottom. Pages are
 * virtualized — only those near the viewport render a canvas (others are sized
 * placeholders), so a 252-page book stays light on memory.
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
  jumpTo,
  jumpNonce,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [baseW, setBaseW] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () =>
      setBaseW((prev) => {
        const w = Math.min(el.clientWidth, 1100);
        return Math.abs(prev - w) > 1 ? w : prev;
      });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cssW = baseW * zoom;

  // Scroll to a requested page (uniform slot heights make the offset exact).
  useEffect(() => {
    const el = scrollRef.current;
    if (jumpTo == null || !el || !cssW) return;
    el.scrollTop = jumpTo * ((cssW * pageH) / pageW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpNonce]);

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
    if (!active || !cssW) return;
    let cancelled = false;
    (async () => {
      const dpr = window.devicePixelRatio || 1;
      const renderScale = Math.min((cssW / pageW) * dpr, MAX_DEVICE_W / pageW);
      const page = await doc.getPage(pageIndex + 1);
      if (cancelled) {
        page.cleanup();
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      await renderPage(page, renderScale, canvas);
      if (!cancelled) {
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${height}px`;
      }
      page.cleanup();
    })();
    return () => {
      cancelled = true;
    };
  }, [active, cssW, doc, pageIndex, pageW, height]);

  // Free pixels when the page scrolls far away.
  useEffect(() => {
    if (active) return;
    const c = canvasRef.current;
    if (c) {
      c.width = 0;
      c.height = 0;
    }
  }, [active]);

  return (
    <div className="page-slot" ref={slotRef} style={{ width: cssW, height }}>
      {active && (
        <>
          <canvas ref={canvasRef} className="page-canvas" />
          {sheetOn &&
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
        </>
      )}
    </div>
  );
}
