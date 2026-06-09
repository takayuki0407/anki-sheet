import { describe, expect, it } from "vitest";
import { cardKey } from "./cardKeys";
import {
  activeClozes,
  addCloze,
  clozeKey,
  clozeMapFromCards,
  mergeContent,
  normalizeContent,
  removeCloze,
  setActiveClozes,
  tombstonesOf,
  type Cloze,
  type ClozeMap,
  type ContentBlob,
} from "./contentMerge";

const bx = (x: number, y: number, w = 20, h = 10) => ({ x, y, w, h });
const cz = (pageIndex: number, x: number, y: number, text = ""): Cloze => ({
  pageIndex,
  rects: [bx(x, y)],
  bbox: bx(x, y),
  text,
});

describe("clozeKey", () => {
  it("matches cardKey so a ★ and its answer share an anchor", () => {
    expect(clozeKey(3, bx(12.4, 30.6))).toBe(cardKey(3, bx(12.4, 30.6)));
  });
});

describe("mergeContent", () => {
  const norm = (b: ContentBlob) => normalizeContent(b, 1);

  it("unions concurrent ADDS from two devices (neither edit is lost)", () => {
    const a = norm({ clozesLww: { ...addClozeMap(cz(0, 0, 100), 10) } });
    const b = norm({ clozesLww: { ...addClozeMap(cz(0, 0, 300), 10) } });
    expect(activeClozes(mergeContent(a, b)).length).toBe(2);
  });

  it("propagates a DELETE (later tombstone wins over an older add)", () => {
    let m: ClozeMap = {};
    addCloze(m, cz(0, 0, 100), 10);
    const added = norm({ clozesLww: { ...m } });
    removeCloze(m, 0, bx(0, 100), 20);
    const deleted = norm({ clozesLww: { ...m } });
    expect(activeClozes(mergeContent(added, deleted))).toHaveLength(0);
    // and a re-add after the delete wins:
    const readded = norm({ clozesLww: addClozeMap(cz(0, 0, 100), 30) });
    expect(activeClozes(mergeContent(deleted, readded))).toHaveLength(1);
  });

  it("picks name/color/geometry by the larger contentAt", () => {
    const older = norm({ name: "old", contentAt: 100 });
    const newer = norm({ name: "new", contentAt: 200 });
    expect(mergeContent(older, newer).name).toBe("new");
    expect(mergeContent(newer, older).name).toBe("new");
  });

  it("is commutative + idempotent on the cloze set", () => {
    const a = norm({ clozesLww: addClozeMap(cz(0, 0, 100), 5) });
    const b = norm({ clozesLww: addClozeMap(cz(0, 0, 100), 9) }); // same key, newer
    expect(activeClozes(mergeContent(a, b))).toEqual(activeClozes(mergeContent(b, a)));
    expect(mergeContent(a, a).clozesLww).toEqual(a.clozesLww);
  });
});

describe("normalizeContent", () => {
  it("folds a legacy clozes[] array only when no map exists", () => {
    const out = normalizeContent({ clozes: [cz(1, 5, 5)] }, 100);
    expect(activeClozes(out)).toHaveLength(1);
    expect(out.clozes).toBeUndefined();
  });
  it("ignores the legacy array (GET mirror) when a map is present — no tombstone resurrection", () => {
    const m: ClozeMap = {};
    removeCloze(m, 0, bx(0, 100), 50); // tombstone
    const out = normalizeContent({ clozesLww: m, clozes: [cz(0, 0, 100)] }, 999);
    expect(activeClozes(out)).toHaveLength(0); // legacy add ignored; stays deleted
  });
});

describe("setActiveClozes (re-detect reconcile)", () => {
  it("adds the detected set and tombstones masks no longer detected", () => {
    const m: ClozeMap = {};
    addCloze(m, cz(0, 0, 100), 1);
    addCloze(m, cz(0, 0, 200), 1);
    setActiveClozes(m, [cz(0, 0, 100), cz(0, 0, 300)], 10); // 200 gone, 300 new
    const live = activeClozes({ clozesLww: m })
      .map((c) => clozeKey(c.pageIndex, c.bbox))
      .sort();
    expect(live).toEqual(["0:100:0", "0:300:0"]);
  });
});

describe("clozeMapFromCards + tombstonesOf (client derive)", () => {
  it("builds live entries from cards (t=createdAt) and folds tombstones; tombstone wins when newer", () => {
    const cards = [
      { pageIndex: 0, rects: [bx(0, 100)], bbox: bx(0, 100), text: "a", t: 5 },
      { pageIndex: 0, rects: [bx(0, 200)], bbox: bx(0, 200), text: "b", t: 5 },
    ];
    const map = clozeMapFromCards(cards, { "0:200:0": 9 }); // 200 deleted after it was added
    expect(activeClozes({ clozesLww: map }).map((c) => clozeKey(c.pageIndex, c.bbox))).toEqual([
      "0:100:0",
    ]);
    expect(tombstonesOf(map)).toEqual({ "0:200:0": 9 });
    // A re-add (card t newer than the tombstone) makes it live again:
    const map2 = clozeMapFromCards([{ ...cards[1], t: 12 }], { "0:200:0": 9 });
    expect(activeClozes({ clozesLww: map2 })).toHaveLength(1);
  });
});

function addClozeMap(c: Cloze, t: number): ClozeMap {
  const m: ClozeMap = {};
  addCloze(m, c, t);
  return m;
}
