import { describe, expect, it } from "vitest";
import { mergeRuns, type ColoredRun } from "./spanMerge";

const run = (x: number, y: number, w: number, h: number, text: string): ColoredRun => ({
  rect: { x, y, w, h },
  text,
});

describe("mergeRuns", () => {
  it("merges adjacent same-line runs into one answer", () => {
    const runs = [run(10, 100, 10, 12, "取"), run(21, 100, 10, 12, "替"), run(32, 100, 10, 12, "資")];
    const merged = mergeRuns(runs, 0.6);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("取替資");
    expect(merged[0].rects).toHaveLength(3);
    expect(merged[0].bbox.x).toBe(10);
    expect(merged[0].bbox.w).toBe(32);
  });

  it("keeps far-apart same-line runs separate", () => {
    const runs = [run(10, 100, 10, 12, "A"), run(200, 100, 10, 12, "B")];
    const merged = mergeRuns(runs, 0.6);
    expect(merged).toHaveLength(2);
  });

  it("keeps runs on different lines separate", () => {
    const runs = [run(10, 100, 10, 12, "上"), run(11, 140, 10, 12, "下")];
    const merged = mergeRuns(runs, 0.6);
    expect(merged).toHaveLength(2);
  });

  it("is order-independent (sorts by line then x)", () => {
    const runs = [run(32, 100, 10, 12, "資"), run(10, 100, 10, 12, "取"), run(21, 100, 10, 12, "替")];
    const merged = mergeRuns(runs, 0.6);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("取替資");
  });
});
