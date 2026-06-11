import { describe, expect, it } from "vitest";
import { pageTopics } from "./topics";

describe("pageTopics", () => {
  it("ページ以前で最も近い目次エントリを使う", () => {
    const texts = new Map([
      [3, "本文…"],
      [10, "本文…"],
    ]);
    const marks = [
      { pageIndex: 0, title: "第1章 総論" },
      { pageIndex: 8, title: "第2章 資産会計" },
    ];
    const t = pageTopics(texts, marks);
    expect(t.get(3)).toBe("第1章 総論");
    expect(t.get(10)).toBe("第2章 資産会計");
  });

  it("目次がなければ本文の見出し行（共通ヘッダー・ページ番号行はスキップ）", () => {
    const texts = new Map([
      [0, "財務諸表論 重要会計基準\n12\n繰延資産\n本文…"],
      [1, "財務諸表論 重要会計基準\n13\n引当金\n本文…"],
      [2, "財務諸表論 重要会計基準\n14\n退職給付\n本文…"],
    ]);
    const t = pageTopics(texts, []);
    expect(t.get(0)).toBe("繰延資産");
    expect(t.get(1)).toBe("引当金");
    expect(t.get(2)).toBe("退職給付");
  });

  it("長いラベルは22字で切り詰める", () => {
    const long = "あ".repeat(40);
    const t = pageTopics(new Map([[0, `${long}\n本文`]]), []);
    expect(t.get(0)).toBe("あ".repeat(22) + "…");
  });

  it("本文テキストが空でも目次ラベルは付く", () => {
    const t = pageTopics(new Map([[5, ""]]), [{ pageIndex: 0, title: "第1章" }]);
    expect(t.get(5)).toBe("第1章");
  });

  it("目次もテキストもないページはラベルなし", () => {
    const t = pageTopics(new Map([[5, ""]]), []);
    expect(t.has(5)).toBe(false);
  });
});
