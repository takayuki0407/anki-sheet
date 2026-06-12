// プラン変更まわりの境界仕様を固定するテスト。特に canFetchOwnBook は「ダウングレード後に
// クラウドのみの本が取り出せなくなる」回帰（2026-06-12 報告）の再発防止。
import { describe, expect, it } from "vitest";
import {
  FREE_DECK_LIMIT,
  STANDARD_DECK_LIMIT,
  TRIAL_GEN_PAGES,
  canFetchOwnBook,
  genLimitDuringTrial,
  genPageLimit,
  isUnlimited,
  limitFor,
} from "./tier";

describe("冊数上限とクラウド同期の対応", () => {
  it("free=1冊 / standard=10冊 / pro・premium・adminは無制限", () => {
    expect(limitFor("free")).toBe(FREE_DECK_LIMIT);
    expect(limitFor("standard")).toBe(STANDARD_DECK_LIMIT);
    for (const t of ["pro", "premium", "admin"] as const) {
      expect(limitFor(t)).toBe(Number.MAX_SAFE_INTEGER);
    }
  });

  it("クラウド同期（isUnlimited）はpro/premium/adminのみ", () => {
    expect(isUnlimited("free")).toBe(false);
    expect(isUnlimited("standard")).toBe(false);
    expect(isUnlimited("pro")).toBe(true);
    expect(isUnlimited("premium")).toBe(true);
    expect(isUnlimited("admin")).toBe(true);
  });
});

describe("canFetchOwnBook — ダウングレード後のデータ取り出し", () => {
  it("ACTIVEな本はどのプランでもオーナーが取得できる（クラウドのみの本を人質にしない）", () => {
    for (const t of ["free", "standard", "pro", "premium", "admin"] as const) {
      expect(canFetchOwnBook("active", t)).toBe(true);
    }
  });

  it("statusの無い行（旧データ）はactive扱いで取得できる", () => {
    expect(canFetchOwnBook(undefined, "free")).toBe(true);
    expect(canFetchOwnBook(null, "standard")).toBe(true);
  });

  it("retained/trimmedはPro以上のみ（re-Pro復元専用の退避データ）", () => {
    for (const s of ["retained", "trimmed"]) {
      expect(canFetchOwnBook(s, "free")).toBe(false);
      expect(canFetchOwnBook(s, "standard")).toBe(false);
      expect(canFetchOwnBook(s, "pro")).toBe(true);
      expect(canFetchOwnBook(s, "premium")).toBe(true);
      expect(canFetchOwnBook(s, "admin")).toBe(true);
    }
  });
});

describe("AI生成枠とトライアル", () => {
  it("プラン別の月間枠", () => {
    expect(genPageLimit("free")).toBe(1);
    expect(genPageLimit("standard")).toBe(10);
    expect(genPageLimit("pro")).toBe(30);
    expect(genPageLimit("premium")).toBe(100);
    expect(genPageLimit("admin")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("トライアル中はPremiumでも30回にキャップ、満了ちょうどで通常枠に戻る", () => {
    const now = 1_000_000;
    expect(genLimitDuringTrial("premium", now + 1, now)).toBe(TRIAL_GEN_PAGES);
    expect(genLimitDuringTrial("premium", now, now)).toBe(100); // trialUntil === now → 満了
    expect(genLimitDuringTrial("premium", 0, now)).toBe(100); // トライアルなし
    expect(genLimitDuringTrial("standard", now + 1, now)).toBe(10); // 枠が小さい側はそのまま
  });
});
