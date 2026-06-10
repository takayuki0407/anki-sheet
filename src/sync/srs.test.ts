import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  answerReview,
  dueQuestionIds,
  mergeReview,
  mergeReviewMaps,
  wrongQuestionIds,
  type ReviewState,
} from "./srs";

const T0 = 1_750_000_000_000;

describe("answerReview (SM-2, q=4/q=1)", () => {
  it("first correct answer → 1 day, ease unchanged", () => {
    const r = answerReview(undefined, true, T0);
    expect(r.intervalD).toBe(1);
    expect(r.reps).toBe(1);
    expect(r.lapses).toBe(0);
    expect(r.ease).toBeCloseTo(2.5, 5); // q=4 → delta 0
    expect(r.dueAt).toBe(T0 + DAY_MS);
    expect(r.lastOk).toBe(1);
  });

  it("correct streak grows 1 → 6 → round(6×ease)", () => {
    let r = answerReview(undefined, true, T0);
    r = answerReview(r, true, T0 + DAY_MS);
    expect(r.intervalD).toBe(6);
    expect(r.reps).toBe(2);
    r = answerReview(r, true, T0 + 7 * DAY_MS);
    expect(r.intervalD).toBe(Math.round(6 * 2.5)); // 15
    expect(r.reps).toBe(3);
    expect(r.dueAt).toBe(T0 + 7 * DAY_MS + 15 * DAY_MS);
  });

  it("wrong answer resets interval to 1 day, counts a lapse, drops ease by 0.54", () => {
    let r = answerReview(undefined, true, T0);
    r = answerReview(r, true, T0 + DAY_MS); // interval 6
    r = answerReview(r, false, T0 + 2 * DAY_MS);
    expect(r.intervalD).toBe(1);
    expect(r.reps).toBe(0);
    expect(r.lapses).toBe(1);
    expect(r.ease).toBeCloseTo(2.5 - 0.54, 5); // q=1 → −0.54
    expect(r.lastOk).toBe(0);
  });

  it("ease is floored at 1.3", () => {
    let r: ReviewState | undefined;
    for (let i = 0; i < 10; i++) r = answerReview(r, false, T0 + i * DAY_MS);
    expect(r!.ease).toBe(1.3);
    expect(r!.lapses).toBe(10);
  });

  it("recovery after a lapse restarts the 1 → 6 ladder", () => {
    let r = answerReview(undefined, false, T0);
    r = answerReview(r, true, T0 + DAY_MS);
    expect(r.intervalD).toBe(1);
    r = answerReview(r, true, T0 + 2 * DAY_MS);
    expect(r.intervalD).toBe(6);
  });
});

describe("merge (per-key LWW)", () => {
  const at = (updatedAt: number, lastOk: 0 | 1 = 1): ReviewState => ({
    ease: 2.5,
    intervalD: 1,
    reps: 1,
    lapses: 0,
    dueAt: updatedAt + DAY_MS,
    lastAt: updatedAt,
    lastOk,
    updatedAt,
  });

  it("newer updatedAt wins, either side", () => {
    expect(mergeReview(at(1), at(2)).updatedAt).toBe(2);
    expect(mergeReview(at(2), at(1)).updatedAt).toBe(2);
    expect(mergeReview(undefined, at(1)).updatedAt).toBe(1);
  });

  it("map merge is commutative and idempotent", () => {
    const a = { q1: at(1), q2: at(5) };
    const b = { q2: at(3), q3: at(4) };
    const ab = mergeReviewMaps(a, b);
    const ba = mergeReviewMaps(b, a);
    expect(ab).toEqual(ba);
    expect(ab.q2.updatedAt).toBe(5);
    expect(mergeReviewMaps(ab, ab)).toEqual(ab);
  });
});

describe("selection helpers", () => {
  it("dueQuestionIds returns due only, most-overdue first", () => {
    const mk = (dueAt: number): ReviewState => ({
      ease: 2.5,
      intervalD: 1,
      reps: 1,
      lapses: 0,
      dueAt,
      lastAt: 0,
      lastOk: 1,
      updatedAt: 0,
    });
    const map = { a: mk(T0 - 5), b: mk(T0 + 99), c: mk(T0 - 99), d: mk(T0) };
    expect(dueQuestionIds(map, T0)).toEqual(["c", "a", "d"]);
  });

  it("wrongQuestionIds returns lastOk=0 only", () => {
    let ok = answerReview(undefined, true, T0);
    let ng = answerReview(undefined, false, T0);
    expect(wrongQuestionIds({ ok, ng })).toEqual(["ng"]);
  });
});
