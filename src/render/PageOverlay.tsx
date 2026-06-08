import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage } from "../pdf/pdfEngine";
import { useDragPan, useTouchPan, useWheelZoom } from "./viewerGestures";
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
  /** Revealed group (card) ids — the whole answer reveals together. */
  revealedIds?: ReadonlySet<string | number>;
  onToggle?: (id: string | number) => void;
  highlightRects?: Rect[];
  /** "page" fits the whole page in the viewport; "width" fits the page width. */
  fitMode?: FitMode;
  /** Zoom factor relative to the fit base (can be < 1). */
  zoom?: number;
  /** Tap the left third to go back, the right third to go forward (Kindle-style). */
  onTapZone?: (dir: -1 | 1) => void;
  maxWidth?: number;
  /** Trackpad pinch / ctrl+wheel zoom: receives a multiplicative factor. */
  onPinchZoom?: (factor: number) => void;
  // ---- Manual mask editing (paged mode) ----
  /** Edit mode: masks render as visible outlines; tapping one deletes it. Page tap-zones are off. */
  editMode?: boolean;
  /** Armed to draw the next mask: a drag on the page draws a rectangle (added on release). */
  drawArm?: boolean;
  /** Add a mask from a drawn rectangle (in page coordinates). */
  onAddMask?: (rect: Rect) => void;
  /** Delete a mask (false positive) by its group/card id. */
  onDeleteMask?: (id: string | number) => void;
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
  onTapZone,
  maxWidth = 900,
  onPinchZoom,
  editMode = false,
  drawArm = false,
  onAddMask,
  onDeleteMask,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draw, setDraw] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const renderToken = useRef(0);
  // Keep the viewport centred on the same spot when zoom reflows the page.
  const anchor = useRef({ hx: 0.5, vy: 0.5 });
  const prevCssW = useRef(0);
  const ticking = useRef(false);

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

  // Re-centre on the same content when zoom (cssW) reflows the page, so zooming in
  // doesn't dump you at the top-left corner.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !cssW) return;
    if (prevCssW.current === 0 || Math.abs(prevCssW.current - cssW) < 0.5) {
      prevCssW.current = cssW;
      return;
    }
    prevCssW.current = cssW;
    const a = anchor.current;
    const maxL = el.scrollWidth - el.clientWidth;
    const maxT = el.scrollHeight - el.clientHeight;
    if (maxL > 0) el.scrollLeft = Math.min(maxL, Math.max(0, a.hx * el.scrollWidth - el.clientWidth / 2));
    if (maxT > 0) el.scrollTop = Math.min(maxT, Math.max(0, a.vy * el.scrollHeight - el.clientHeight / 2));
  }, [cssW]);

  const onScroll = () => {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      const el = scrollRef.current;
      if (!el) return;
      anchor.current = {
        hx: el.scrollWidth > el.clientWidth ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth : 0.5,
        vy: el.scrollHeight > el.clientHeight ? (el.scrollTop + el.clientHeight / 2) / el.scrollHeight : 0.5,
      };
    });
  };

  return (
    <div className="page-scroll" ref={scrollRef} onScroll={onScroll}>
      <div
        className={`page-stage${onTapZone && !editMode ? " tappable" : ""}`}
        ref={stageRef}
        style={{ width: cssW || undefined }}
        onClick={(e) => {
          if (!onTapZone || editMode) return;
          const r = e.currentTarget.getBoundingClientRect();
          const f = (e.clientX - r.left) / r.width;
          if (f < 0.33) onTapZone(-1);
          else if (f > 0.67) onTapZone(1);
        }}
      >
        <canvas ref={canvasRef} className="page-canvas" />
        {fitScale > 0 &&
          groups.map((g) => {
            // The whole answer (card) reveals together — a wrapped answer stays one card, while
            // detection keeps genuinely separate answers as separate cards.
            const revealed = revealedIds.has(g.id);
            return g.rects.map((r, i) => {
              const h = r.h * fitScale;
              return (
                <div
                  key={`${g.id}:${i}`}
                  className={editMode ? "mask mask-edit" : revealed ? "reveal-zone" : "mask"}
                  style={
                    {
                      left: r.x * fitScale,
                      top: r.y * fitScale,
                      width: r.w * fitScale,
                      height: h,
                      // Mouse-only: a slightly-larger click target (~0.3x line height). See .mask::after.
                      "--tap-pad": `${Math.max(4, h * 0.3)}px`,
                    } as CSSProperties
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editMode) onDeleteMask?.(g.id);
                    else onToggle?.(g.id);
                  }}
                  title={editMode ? "タップで削除" : undefined}
                />
              );
            });
          })}
        {editMode && drawArm && (
          <div
            className="draw-surface"
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const r = stageRef.current!.getBoundingClientRect();
              const x = e.clientX - r.left;
              const y = e.clientY - r.top;
              setDraw({ x0: x, y0: y, x, y });
            }}
            onPointerMove={(e) => {
              const cx = e.clientX;
              const cy = e.clientY;
              setDraw((d) => {
                if (!d) return d;
                const r = stageRef.current!.getBoundingClientRect();
                return { ...d, x: cx - r.left, y: cy - r.top };
              });
            }}
            onPointerUp={() => {
              setDraw((d) => {
                if (d && fitScale > 0) {
                  const x = Math.min(d.x0, d.x);
                  const y = Math.min(d.y0, d.y);
                  const w = Math.abs(d.x - d.x0);
                  const h = Math.abs(d.y - d.y0);
                  if (w > 6 && h > 6)
                    onAddMask?.({ x: x / fitScale, y: y / fitScale, w: w / fitScale, h: h / fitScale });
                }
                return null;
              });
            }}
          >
            {draw && (
              <div
                className="draw-rect"
                style={{
                  left: Math.min(draw.x0, draw.x),
                  top: Math.min(draw.y0, draw.y),
                  width: Math.abs(draw.x - draw.x0),
                  height: Math.abs(draw.y - draw.y0),
                }}
              />
            )}
          </div>
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
