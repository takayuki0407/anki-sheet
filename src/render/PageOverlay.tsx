import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage } from "../pdf/pdfEngine";
import type { Rect } from "../types";

export interface MaskGroup {
  id: string | number;
  rects: Rect[];
}

export type FitMode = "page" | "width";

const EMPTY: ReadonlySet<string | number> = new Set();
const MAX_DEVICE_W = 2800; // cap rendered canvas width (memory)

interface Props {
  doc: PDFDocumentProxy;
  pageIndex: number; // 0-based
  pageW: number; // page coordinates (points)
  pageH?: number; // page height (points) — needed for fit-to-page
  groups?: MaskGroup[];
  revealedIds?: ReadonlySet<string | number>;
  onToggle?: (id: string | number) => void;
  highlightRects?: Rect[];
  /** "page" fits the whole page in the viewport; "width" fits the page width. */
  fitMode?: FitMode;
  /** Zoom factor relative to the fit base (can be < 1). */
  zoom?: number;
  maxWidth?: number;
}

/**
 * Renders a PDF page to a canvas and overlays the red-sheet masks / highlights.
 * The single source of truth for PDF-bbox -> pixel mapping. "fit page" sizes the
 * page so the whole (portrait) page is visible; zoom (incl. < 1) scales from there.
 */
export function PageOverlay({
  doc,
  pageIndex,
  pageW,
  pageH,
  groups = [],
  revealedIds = EMPTY,
  onToggle,
  highlightRects,
  fitMode = "width",
  zoom = 1,
  maxWidth = 900,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const renderToken = useRef(0);

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

  const aspect = pageH && pageH > 0 ? pageW / pageH : 0.7;
  const fitBaseW =
    fitMode === "page" && dims.h > 0
      ? Math.min(dims.w, dims.h * aspect)
      : Math.min(dims.w, maxWidth);
  const cssW = fitBaseW * zoom;

  useEffect(() => {
    if (!cssW || cssW < 1) return;
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
