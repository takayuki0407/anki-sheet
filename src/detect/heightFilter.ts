import type { DetectedCloze } from "../types";

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Drop answers much taller than the median — these are almost always magenta
 * HEADINGS / chapter titles, not fill-in-the-blank answers. Needs a population to
 * estimate the body height, so it no-ops on very small inputs.
 */
export function filterByHeight(clozes: DetectedCloze[], maxRatio: number): DetectedCloze[] {
  if (clozes.length < 8 || maxRatio <= 0) return clozes;
  const med = median(clozes.map((c) => c.bbox.h));
  if (med <= 0) return clozes;
  const limit = med * maxRatio;
  return clozes.filter((c) => c.bbox.h <= limit);
}
