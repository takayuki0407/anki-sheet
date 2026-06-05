import type { DeckColorConfig, DetectedCloze, Rect } from "../types";
import { sampleBox, type PagePixels } from "./pixelSampler";
import { mergeRuns, type ColoredRun } from "./spanMerge";

/** A text run with the device-space box to sample (computed from a pdf.js item). */
export interface RunCandidate {
  str: string;
  deviceBox: Rect;
}

function deviceToPage(r: Rect, scale: number): Rect {
  return { x: r.x / scale, y: r.y / scale, w: r.w / scale, h: r.h / scale };
}

/**
 * Core detection: given a rendered page (device pixels) and its text runs, return
 * the colored answers as cloze rects in page coordinates. Pure and environment-
 * agnostic — the browser and the Node integration test both feed it the same shape.
 */
export function detectPage(
  pageIndex: number,
  pixels: PagePixels,
  runs: RunCandidate[],
  cfg: DeckColorConfig,
  scale: number,
): DetectedCloze[] {
  const colored: ColoredRun[] = [];

  for (const run of runs) {
    if (!run.str || !run.str.trim()) continue;
    const s = sampleBox(pixels, run.deviceBox, cfg);
    if (!s.tightDeviceRect) continue;
    if (s.bandPx < cfg.minBandPx) continue;
    if (s.bandPx < s.inkPx * cfg.inkRatioFloor) continue;
    colored.push({ rect: deviceToPage(s.tightDeviceRect, scale), text: run.str });
  }

  return mergeRuns(colored, cfg.spanGapEm).map((m) => ({
    pageIndex,
    rects: m.rects,
    bbox: m.bbox,
    text: m.text,
  }));
}
