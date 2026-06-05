import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
// Vite resolves these to served asset URLs.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { DeckColorConfig, DetectedCloze } from "../types";
import { DETECT_SCALE } from "../types";
import { detectPage, type RunCandidate } from "../detect/detectPage";
import { runBox } from "../detect/runGeometry";
import { filterByHeight } from "../detect/heightFilter";
import type { PagePixels } from "../detect/pixelSampler";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// cMaps + standard fonts are copied into public/pdfjs (see scripts/copy-pdfjs-assets.mjs).
// They are REQUIRED: without them, CJK (CID) fonts neither render nor extract text.
const CMAP_URL = new URL("pdfjs/cmaps/", document.baseURI).toString();
const STANDARD_FONT_URL = new URL("pdfjs/standard_fonts/", document.baseURI).toString();

export async function loadPdf(data: ArrayBuffer | Blob): Promise<PDFDocumentProxy> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  return pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_URL,
  }).promise;
}

export interface PageSize {
  width: number;
  height: number;
}

/** Page size in page coordinates (PDF points). */
export function pageSize(page: PDFPageProxy): PageSize {
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Serialize page renders: pdf.js rejects overlapping render() calls on one canvas,
// and rendering the same page proxy concurrently is unsafe. A simple promise chain
// keeps every render strictly sequential across the whole app.
let renderLock: Promise<unknown> = Promise.resolve();

/** Render a page into a 2D canvas at the given scale (serialized app-wide). */
export async function renderPage(
  page: PDFPageProxy,
  scale: number,
  canvas?: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const run = async () => {
    const viewport = page.getViewport({ scale });
    const c = canvas ?? makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    c.width = Math.ceil(viewport.width);
    c.height = Math.ceil(viewport.height);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    await page.render({ canvasContext: ctx, viewport, canvas: c }).promise;
    return c;
  };
  const result = renderLock.then(run, run);
  renderLock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function pixelsFrom(canvas: HTMLCanvasElement): PagePixels {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: img.width, height: img.height, data: img.data };
}

/** Build sampling boxes (device px) for each text run on the page. */
export async function runCandidates(
  page: PDFPageProxy,
  scale: number,
): Promise<RunCandidate[]> {
  const viewport = page.getViewport({ scale });
  const tc = await page.getTextContent();
  const out: RunCandidate[] = [];
  for (const item of tc.items) {
    if (!("transform" in item)) continue; // skip TextMarkedContent
    const str = item.str;
    if (!str || !str.trim()) continue;
    const box = runBox(viewport.transform as number[], item.transform, item.width, scale);
    if (box.h <= 0) continue;
    out.push({ str, deviceBox: box });
  }
  return out;
}

/** Detect colored answers on a single already-open page (used by the live tuner). */
export async function detectOnPage(
  page: PDFPageProxy,
  cfg: DeckColorConfig,
  scale: number,
  canvas?: HTMLCanvasElement,
): Promise<DetectedCloze[]> {
  const c = await renderPage(page, scale, canvas);
  const px = pixelsFrom(c);
  const runs = await runCandidates(page, scale);
  return detectPage(page.pageNumber - 1, px, runs, cfg, scale);
}

/** Detect on one page of an open document (for tuner preview). */
export async function detectSinglePage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  cfg: DeckColorConfig,
): Promise<DetectedCloze[]> {
  const page = await doc.getPage(pageIndex + 1);
  try {
    return await detectOnPage(page, cfg, DETECT_SCALE);
  } finally {
    page.cleanup();
  }
}

export interface PdfDetectionResult {
  pageCount: number;
  pageW: number;
  pageH: number;
  clozes: DetectedCloze[];
}

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

/**
 * Render + detect colored answers across every page of a PDF. Cleans up each page
 * as it goes (bounded memory) and yields between pages so the UI stays responsive.
 * Pass an AbortSignal to cancel mid-run. A height-outlier pass drops heading
 * false-positives at the end.
 */
export async function detectClozesInPdf(
  data: ArrayBuffer | Blob,
  cfg: DeckColorConfig,
  onProgress?: (page: number, total: number, found: number) => void,
  signal?: AbortSignal,
): Promise<PdfDetectionResult> {
  const doc = await loadPdf(data);
  const pageCount = doc.numPages;
  const canvas = makeCanvas(1, 1);
  let clozes: DetectedCloze[] = [];
  let pageW = 0;
  let pageH = 0;
  try {
    for (let p = 1; p <= pageCount; p++) {
      if (signal?.aborted) throw new CancelledError();
      const page = await doc.getPage(p);
      try {
        if (p === 1) {
          const sz = pageSize(page);
          pageW = sz.width;
          pageH = sz.height;
        }
        clozes.push(...(await detectOnPage(page, cfg, DETECT_SCALE, canvas)));
      } finally {
        page.cleanup();
      }
      onProgress?.(p, pageCount, clozes.length);
      await yieldToUI();
    }
    clozes = filterByHeight(clozes, cfg.maxHeightRatio);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    await doc.loadingTask.destroy();
  }
  return { pageCount, pageW, pageH, clozes };
}
