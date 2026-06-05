import type { Rect } from "../types";

export interface ColoredRun {
  rect: Rect;
  text: string;
}

export interface MergedAnswer {
  rects: Rect[];
  bbox: Rect;
  text: string;
}

const yc = (r: Rect) => r.y + r.h / 2;

function unionRect(rects: Rect[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Merge colored runs that belong to one answer. Two-step so grouping is correct and
 * order-stable: (1) cluster runs into text lines by y-center (a total-order sort,
 * not a fuzzy comparator); (2) within each line, sort by x and merge runs whose gap
 * from the group's RUNNING right edge is small — including overlapping runs (gap < 0),
 * which pdf.js often emits for CID/CJK glyphs. Handles multi-glyph terms split across
 * runs (e.g. headings emitted one character at a time).
 */
export function mergeRuns(runs: ColoredRun[], spanGapEm: number): MergedAnswer[] {
  if (runs.length === 0) return [];

  // 1. Cluster into lines by y-center (numeric total order).
  const sorted = [...runs].sort((a, b) => yc(a.rect) - yc(b.rect) || a.rect.x - b.rect.x);
  const lines: ColoredRun[][] = [];
  let line: ColoredRun[] = [];
  let anchorYc = 0;
  for (const r of sorted) {
    if (line.length === 0) {
      line = [r];
      anchorYc = yc(r.rect);
      continue;
    }
    if (Math.abs(yc(r.rect) - anchorYc) <= 0.6 * r.rect.h) {
      line.push(r);
    } else {
      lines.push(line);
      line = [r];
      anchorYc = yc(r.rect);
    }
  }
  if (line.length) lines.push(line);

  // 2. Within each line, merge by running right edge.
  const groups: ColoredRun[][] = [];
  for (const ln of lines) {
    ln.sort((a, b) => a.rect.x - b.rect.x);
    let cur: ColoredRun[] = [];
    let rightEdge = -Infinity;
    for (const r of ln) {
      if (cur.length === 0) {
        cur = [r];
        rightEdge = r.rect.x + r.rect.w;
        continue;
      }
      const gapLimit = spanGapEm * Math.max(cur[cur.length - 1].rect.h, r.rect.h);
      const gap = r.rect.x - rightEdge; // negative => overlap (still merge)
      if (gap <= gapLimit) {
        cur.push(r);
        rightEdge = Math.max(rightEdge, r.rect.x + r.rect.w);
      } else {
        groups.push(cur);
        cur = [r];
        rightEdge = r.rect.x + r.rect.w;
      }
    }
    if (cur.length) groups.push(cur);
  }

  return groups.map((g) => ({
    rects: g.map((r) => r.rect),
    bbox: unionRect(g.map((r) => r.rect)),
    text: g.map((r) => r.text).join(""),
  }));
}
