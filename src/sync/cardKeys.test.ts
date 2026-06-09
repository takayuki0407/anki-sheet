import { describe, expect, it } from "vitest";
import { cardKey, cardKeyMaps, correspondCards } from "./cardKeys";

const r = (x: number, y: number, w = 10, h = 8) => ({ x, y, w, h });

describe("cardKey", () => {
  it("is page + quantized answer position AND size (NOT an ordinal), so it survives answer add/remove", () => {
    expect(cardKey(5, r(12.4, 30.6))).toBe("5:31:12:10:8"); // page:round(y):round(x):round(w):round(h)
    // The SAME answer keeps its key regardless of how many other answers share the page.
    expect(cardKey(5, r(12.4, 30.6))).toBe(cardKey(5, r(12.4, 30.6)));
    // Two answers whose TOP-LEFT rounds the same but differ in size get DISTINCT keys (dense page).
    expect(cardKey(5, r(12.4, 30.6, 10, 8))).not.toBe(cardKey(5, r(12.4, 30.6, 40, 8)));
  });
});

describe("cardKeyMaps", () => {
  it("maps id<->position key and skips cards without an id", () => {
    const { idToKey, keyToId } = cardKeyMaps([
      { id: 1, pageIndex: 0, answerRect: r(10, 20) },
      { id: 2, pageIndex: 0, answerRect: r(10, 90) },
      { pageIndex: 0, answerRect: r(0, 0) }, // no id -> skipped
    ]);
    expect(idToKey.get(1)).toBe("0:20:10:10:8");
    expect(keyToId.get("0:90:10:10:8")).toBe(2);
    expect(idToKey.size).toBe(2);
  });
});

describe("correspondCards (re-detect carry-over)", () => {
  it("matches old answers to the overlapping new ones; an inserted answer shifts nothing", () => {
    // page 0 had two answers; a re-detect inserts a NEW answer between them. The old two must still
    // map to the same physical answers (the bug: ordinal would shift answer #2 onto the newcomer).
    const oldCards = [
      { id: 10, pageIndex: 0, answerRect: r(0, 100) },
      { id: 11, pageIndex: 0, answerRect: r(0, 300) },
    ];
    const newCards = [
      { id: 50, pageIndex: 0, answerRect: r(0, 100) }, // == old 10
      { id: 51, pageIndex: 0, answerRect: r(0, 200) }, // inserted, no old match
      { id: 52, pageIndex: 0, answerRect: r(0, 300) }, // == old 11
    ];
    const corr = correspondCards(oldCards, newCards);
    expect(corr.get(10)).toBe(50);
    expect(corr.get(11)).toBe(52);
    expect([...corr.values()]).not.toContain(51);
  });

  it("drops an old answer that no longer overlaps anything, and never double-assigns", () => {
    const oldCards = [
      { id: 1, pageIndex: 0, answerRect: r(0, 0) },
      { id: 2, pageIndex: 0, answerRect: r(0, 500) }, // disappears on re-detect
    ];
    const newCards = [{ id: 9, pageIndex: 0, answerRect: r(0, 2) }]; // overlaps id1 only
    const corr = correspondCards(oldCards, newCards);
    expect(corr.get(1)).toBe(9);
    expect(corr.has(2)).toBe(false);
  });

  it("never matches across pages", () => {
    const corr = correspondCards(
      [{ id: 1, pageIndex: 0, answerRect: r(0, 0) }],
      [{ id: 2, pageIndex: 1, answerRect: r(0, 0) }],
    );
    expect(corr.size).toBe(0);
  });
});
