import { describe, expect, it } from "vitest";
import { extractHeadings, pageTopics } from "./topics";

describe("extractHeadings", () => {
  it("マーカー付き・章番号・数字始まりの見出しを拾い、文の途中ページは飛ばす", () => {
    const texts = new Map([
      [0, "❖ 1 一般原則\n本文がここに続いていく。さらに本文。"],
      [1, "ら計上することが認められる。続きの本文がここに続いていく。\nさらに本文が続く。"], // mid-sentence → no heading
      [2, "第3章 資産会計\n本文がここに続いていく。"],
      [3, "1 重要性の原則\n本文がここに続いていく。"],
    ]);
    expect(extractHeadings(texts)).toEqual([
      { pageIndex: 0, title: "1 一般原則" },
      { pageIndex: 2, title: "第3章 資産会計" },
      { pageIndex: 3, title: "1 重要性の原則" },
    ]);
  });

  it("実PDFの章扉（重要度バッジで分断されたバナー）を縫合し、章は扉ページから始まる", () => {
    // 「2026年度版 財務諸表論 重要会計基準」P.12〜P.15 の実抽出行
    const texts = new Map([
      [11, "企業会計原則及び\n企業会計原則注解\n最終改正 昭和57年４月20日\n１ 一般原則\n２ 損益計算書原則\n３ 貸借対照表原則\n第１章"],
      [12, "2\n１ 重要度\n★★★一般原則\n会計原則会計原則会計原則\n真実性の原則⑴\n一 企業会計は、企業の 財政状態 及び 経営成績 に関して報告する。"],
      [13, "3\n❖ １ 一般原則\n第\n１\n章"],
      [14, "4\n注 解\n（注３）継続性の原則について\n企業会計上継続性が問題とされるのは、１つの会計事実についてである。"],
    ]);
    const toc = extractHeadings(texts);
    expect(toc).toEqual([{ pageIndex: 11, title: "１ 一般原則" }]);
    const t = pageTopics([12, 13, 14], toc);
    expect(t.get(12)).toBe("１ 一般原則");
    expect(t.get(13)).toBe("１ 一般原則");
    expect(t.get(14)).toBe("１ 一般原則");
  });

  it("2行に分かれたタイトルを章番号と結合し、扉と❖バナーを1エントリに統合する", () => {
    // 同書 P.27〜P.28 の実抽出行
    const texts = new Map([
      [26, "16\n１ 重要度\n★★★\n連続意見書第三\n有形固定資産の減価償却について\n企業会計原則と減価償却第一\n意 見 書"],
      [27, "17\n❖ １ 連続意見書第三 有形固定資産の減価償却について\n第\n２\n章"],
    ]);
    expect(extractHeadings(texts)).toEqual([
      { pageIndex: 26, title: "１ 連続意見書第三 有形固定資産の減価償却について" },
    ]);
  });

  it("繰り返し装飾（会計原則会計原則…）はタイトルに結合しない", () => {
    const texts = new Map([
      [0, "5\n１\n会計原則会計原則会計原則\n本文がここに続いていく。"],
    ]);
    expect(extractHeadings(texts)).toEqual([]);
  });

  it("同じ見出しが連続するページは1エントリにまとめる", () => {
    const texts = new Map([
      [0, "❖ 1 減価償却\n本文がここに続いていく。"],
      [1, "❖ 1 減価償却\n本文がここに続いていく。"],
      [2, "❖ 2 引当金\n本文がここに続いていく。"],
    ]);
    expect(extractHeadings(texts)).toEqual([
      { pageIndex: 0, title: "1 減価償却" },
      { pageIndex: 2, title: "2 引当金" },
    ]);
  });

  it("多数のページに繰り返し出る行（柱）は見出しにしない", () => {
    const texts = new Map<number, string>();
    for (let p = 0; p < 10; p++) texts.set(p, "【財務諸表論】\n本文がここに続いていく。");
    texts.set(4, "【財務諸表論】\n第2章 負債会計\n本文がここに続いていく。");
    const toc = extractHeadings(texts);
    expect(toc).toEqual([{ pageIndex: 4, title: "第2章 負債会計" }]);
  });

  it("「。」で終わる行・長すぎる行・数字だけの行は見出しにしない", () => {
    const texts = new Map([
      [0, "1 これは見出しではなく文である。\n12\n" + "あ".repeat(40) + "\n本文がここに続いていく。"],
    ]);
    expect(extractHeadings(texts)).toEqual([]);
  });
});

describe("pageTopics", () => {
  const toc = [
    { pageIndex: 0, title: "第1章 総論" },
    { pageIndex: 8, title: "第2章 資産会計" },
  ];

  it("ページ以前で最も近いエントリを前方に引き継ぐ", () => {
    const t = pageTopics([3, 8, 10], toc);
    expect(t.get(3)).toBe("第1章 総論");
    expect(t.get(8)).toBe("第2章 資産会計");
    expect(t.get(10)).toBe("第2章 資産会計");
  });

  it("最初のエントリより前のページはラベルなし", () => {
    const t = pageTopics([2], [{ pageIndex: 5, title: "第1章" }]);
    expect(t.has(2)).toBe(false);
  });

  it("長いラベルは22字で切り詰める", () => {
    const long = "あ".repeat(40);
    const t = pageTopics([0], [{ pageIndex: 0, title: long }]);
    expect(t.get(0)).toBe("あ".repeat(22) + "…");
  });
});
