import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage } from "../pdf/pdfEngine";
import type { Rect } from "../types";

export interface MaskGroup {
  id: string | number;
  rects: Rect[];
}

const EMPTY: ReadonlySet<string | number> = new Set();
const MAX_DEVICE_W = 2800; // cap rendered canvas width (memory)

interface Props {
  doc: PDFDocumentProxy;
  pageIndex: number; // 0-based
  pageW: number; // page coordinates (points)
  groups?: MaskGroup[];
  revealedIds?: ReadonlySet<string | number>;
  onToggle?: (id: string | number) => void;
  /** Translucent highlight rects (tuner preview). */
  highlightRects?: Rect[];
  /** Zoom factor (1 = fit width). Re-renders crisp per step, scrolls when > fit. */
  zoom?: number;
  maxWidth?: number;
}

/**
 * Renders a PDF page to a canvas and overlays the red-sheet masks / highlights.
 * The single source of truth for PDF-bbox -> pixel mapping. Supports zoom (the page
 * is re-rendered at the zoomed scale, capped, and scrolls inside its container).
 */
export function PageOverlay({
  doc,
  pageIndex,
  pageW,
  groups = [],
  revealedIds = EMPTY,
  onToggle,
  highlightRects,
  zoom = 1,
  maxWidth = 900,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [baseW, setBaseW] = useState(0);
  const renderToken = useRef(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.min(el.clientWidth, maxWidth);
      setBaseW((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  const cssW = baseW * zoom;

  useEffect(() => {
    if (!cssW) return;
    const dpr = window.devicePixelRatio || 1;
    const renderScale = Math.min((cssW / pageW) * dpr, MAX_DEVICE_W / pageW);
    const token = ++renderToken.current;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (cancelled || token !== renderToken.current) {
        page.cleanup();
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      await renderPage(page, renderScale, canvas);
      if (token === renderToken.current) {
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${(cssW * canvas.height) / canvas.width}px`;
      }
      page.cleanup();
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex, pageW, cssW]);

  const fitScale = cssW ? cssW / pageW : 0;

  return (
    <div className="page-scroll" ref={scrollRef}>
      <div className="page-stage" style={{ width: cssW || undefined }}>
        <canvas ref={canvasRef} className="page-canvas" />
        {fitScale > 0 &&
          groups.map((g) =>
            revealedIds.has(g.id)
              ? null
              : g.rects.map((r, i) => (
                  <div
                    key={`${g.id}:${i}`}
                    className="mask"
                    style={{
                      left: r.x * fitScale,
                      top: r.y * fitScale,
                      width: r.w * fitScale,
                      height: r.h * fitScale,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle?.(g.id);
                    }}
                  />
                )),
          )}
        {fitScale > 0 &&
          highlightRects?.map((r, i) => (
            <div
              key={`h:${i}`}
              className="highlight"
              style={{
                left: r.x * fitScale,
                top: r.y * fitScale,
                width: r.w * fitScale,
                height: r.h * fitScale,
              }}
            />
          ))}
      </div>
    </div>
  );
}
