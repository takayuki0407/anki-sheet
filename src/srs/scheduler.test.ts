import { describe, expect, it } from "vitest";
import { applyGrade, formatInterval, newCard, preview } from "./scheduler";

const NOW = 1_750_000_000_000; // fixed epoch-ms for determinism

describe("newCard", () => {
  it("starts in the New state with due ~ now", () => {
    const c = newCard(NOW);
    expect(c.state).toBe(0);
    expect(c.reps).toBe(0);
    expect(Math.abs(c.due - NOW)).toBeLessThan(1000);
  });
});

describe("preview", () => {
  it("returns four outcomes with non-decreasing intervals", () => {
    const p = preview(newCard(NOW), NOW);
    expect(Object.keys(p)).toHaveLength(4);
    expect(p[4].due).toBeGreaterThanOrEqual(p[1].due); // Easy >= Again
    for (const r of [1, 2, 3, 4] as const) {
      expect(typeof p[r].intervalText).toBe("string");
      expect(p[r].intervalText.length).toBeGreaterThan(0);
    }
  });
});

describe("applyGrade", () => {
  it("schedules a New card into the future and logs the rating", () => {
    const applied = applyGrade(newCard(NOW), NOW, 3);
    expect(applied.state.due).toBeGreaterThan(NOW);
    expect(applied.state.reps).toBe(1);
    expect(applied.log.rating).toBe(3);
    expect(applied.log.review).toBe(NOW);
  });
});

describe("formatInterval", () => {
  it("formats sub-day and day intervals", () => {
    expect(formatInterval(30_000)).toBe("今すぐ");
    expect(formatInterval(10 * 60_000)).toBe("10分");
    expect(formatInterval(3 * 3600_000)).toBe("3時間");
    expect(formatInterval(26 * 3600_000)).toBe("1日");
    expect(formatInterval(45 * 86400_000)).toContain("ヶ月");
  });
});
