import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage } from "../pdf/pdfEngine";
import type { Rect } from "../types";

export interface MaskGroup {
  id: string | number;
  rects: Rect[];
}

const EMPTY: ReadonlySet<string | number> = new Set();

interface Props {
  doc: PDFDocumentProxy;
  pageIndex: number; // 0-based
  pageW: number; // page coordinates (points)
  /** Mask groups to cover with the red sheet (page coordinates). */
  groups?: MaskGroup[];
  /** Group ids that are currently revealed (mask lifted). */
  revealedIds?: ReadonlySet<string | number>;
  /** Toggle a single group's reveal (tap on its mask). */
  onToggle?: (id: string | number) => void;
  /** Translucent highlight rects (tuner preview — what would be captured). */
  highlightRects?: Rect[];
  maxWidth?: number;
}

/**
 * Renders a PDF page to a canvas and overlays opaque "red sheet" rectangles over
 * each mask group. The single source of truth for PDF-bbox -> pixel mapping; backs
 * both the SRS reviewer and the standalone red-sheet viewer.
 */
export function PageOverlay({
  doc,
  pageIndex,
  pageW,
  groups = [],
  revealedIds = EMPTY,
  onToggle,
  highlightRects,
  maxWidth = 760,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [displayW, setDisplayW] = useState(0);
  const renderToken = useRef(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setDisplayW(Math.min(el.clientWidth, maxWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  useEffect(() => {
    if (!displayW) return;
    const dpr = window.devicePixelRatio || 1;
    const fitScale = displayW / pageW;
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
      await renderPage(page, fitScale * dpr, canvas);
      if (token === renderToken.current) {
        canvas.style.width = `${displayW}px`;
        canvas.style.height = `${canvas.height / dpr}px`;
      }
      page.cleanup();
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex, pageW, displayW]);

  const fitScale = displayW ? displayW / pageW : 0;
  const PAD = 1.5; // px, so anti-aliased glyph edges are fully covered

  return (
    <div className="page-overlay" ref={wrapRef}>
      <div className="page-stage" style={{ width: displayW || undefined }}>
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
                      left: r.x * fitScale - PAD,
                      top: r.y * fitScale - PAD,
                      width: r.w * fitScale + 2 * PAD,
                      height: r.h * fitScale + 2 * PAD,
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
