import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage } from "../pdf/pdfEngine";
import type { FitMode } from "../render/PageOverlay";
import { useDragPan, useTouchPan, useWheelZoom } from "../render/viewerGestures";
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
  /** Reports the top visible page as the user scrolls. */
  onVisiblePage?: (page: number) => void;
  /** Trackpad pinch / ctrl+wheel zoom: receives a multiplicative factor. */
  onPinchZoom?: (factor: number) => void;
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
  onVisiblePage,
  onPinchZoom,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const appliedNonce = useRef<number | undefined>(undefined);
  const ticking = useRef(false);
  const lastReported = useRef(-1);
  // Current reading position, kept fresh on scroll so it can be re-pinned after a
  // reflow (zoom / fit-mode / full-screen) instead of drifting to another page.
  const anchor = useRef({ page: jumpTo ?? 0, frac: 0, hCenter: 0.5 });
  const prevCssW = useRef(0);

  useDragPan(scrollRef); // mouse/pen hand-tool pan
  useTouchPan(scrollRef); // touch: angle-based vertical / free 2D pan with momentum
  useWheelZoom(scrollRef, onPinchZoom); // trackpad / ctrl+wheel zoom (desktop)

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

  // Pin the current page when the layout reflows (zoom, fit-mode, or entering /
  // leaving full-screen all change cssW and therefore every slot's height). Without
  // this the constant pixel scrollTop would land on a different page after resize.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !cssW) return;
    if (prevCssW.current === 0 || Math.abs(prevCssW.current - cssW) < 0.5) {
      prevCssW.current = cssW; // first measure: let the jump effect place us
      return;
    }
    prevCssW.current = cssW;
    const a = anchor.current;
    const slot = el.querySelector<HTMLElement>(`[data-page="${a.page}"]`);
    if (slot) el.scrollTop = slot.offsetTop + a.frac * slot.offsetHeight;
    const maxLeft = el.scrollWidth - el.clientWidth;
    el.scrollLeft =
      maxLeft > 0 ? Math.min(maxLeft, Math.max(0, a.hCenter * el.scrollWidth - el.clientWidth / 2)) : 0;
  }, [cssW]);

  const onScroll = () => {
    if (ticking.current || !cssW) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      const el = scrollRef.current;
      if (!el) return;
      const pitch = (cssW * pageH) / pageW + 12; // slot height + margin
      const rel = el.scrollTop - 8;
      const exact = pitch > 0 ? rel / pitch : 0;
      anchor.current = {
        page: Math.max(0, Math.min(pageCount - 1, Math.floor(exact))),
        frac: exact - Math.floor(exact),
        hCenter:
          el.scrollWidth > el.clientWidth
            ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth
            : 0.5,
      };
      const p = Math.max(0, Math.min(pageCount - 1, Math.round(rel / pitch)));
      if (p !== lastReported.current) {
        lastReported.current = p;
        onVisiblePage?.(p);
      }
    });
  };

  return (
    <div className="continuous-scroll" ref={scrollRef} onScroll={onScroll}>
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
