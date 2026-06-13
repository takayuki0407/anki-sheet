// Generates public/sample.pdf — a 2-page red-sheet study sample for App Review.
// Black prompts + magenta (#CC0066, hue ~330, inside DEFAULT_MAGENTA_BAND) answers,
// each answer bracketed by black 〔 〕 so it becomes a discrete detected cloze.
// Rendered via puppeteer-core + installed Chrome/Edge → real text layer + embedded
// JP font (ToUnicode), so pdf.js getTextContent() recovers the answer strings and
// @napi-rs/canvas rasterization yields in-band magenta pixels.
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const out = fileURLToPath(new URL("../public/sample.pdf", import.meta.url));

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body { color: #111111; font-family: "Yu Gothic", "Meiryo", "MS Gothic", sans-serif;
  font-size: 17px; line-height: 2.0; padding: 48px 56px; }
h1 { font-size: 24px; margin: 0 0 10px; }
h2 { font-size: 19px; margin: 22px 0 6px; }
.note { font-size: 14px; color: #333333; line-height: 1.7; margin: 0 0 10px; }
.q { margin: 6px 0; }
.a { color: #CC0066; font-weight: 700; }
.pagebreak { page-break-before: always; }
.foot { margin-top: 28px; font-size: 12px; color: #555555; }
</style></head><body>
<h1>簿記・会計の基礎（サンプル）</h1>
<p class="note">この行は説明です。<b>マゼンタ色の文字が「答え」</b>です。アプリで答えを隠して暗記し、AI生成で問題を確かめましょう。This is a sample study sheet; magenta text are the hidden answers.</p>

<h2>1. 会計の基本等式</h2>
<p class="q">資産 ＝ 負債 ＋ 〔<span class="a">純資産</span>〕</p>

<h2>2. 簿記の5要素</h2>
<p class="q">企業が保有する財産・権利を〔<span class="a">資産</span>〕という。</p>
<p class="q">将来支払うべき義務（債務）を〔<span class="a">負債</span>〕という。</p>
<p class="q">資産から負債を差し引いた正味財産を〔<span class="a">純資産</span>〕という。</p>
<p class="q">経営活動から生じた成果（売上など）を〔<span class="a">収益</span>〕という。</p>
<p class="q">収益を得るために費やした金額を〔<span class="a">費用</span>〕という。</p>

<div class="pagebreak"></div>

<h1>一問一答（サンプル）</h1>
<p class="q">Q1. 収益から費用を差し引いた利益を何というか。　答え：〔<span class="a">当期純利益</span>〕</p>
<p class="q">Q2. 取引を借方と貸方に分けて記録することを何というか。　答え：〔<span class="a">仕訳</span>〕</p>
<p class="q">Q3. 一定時点の財政状態を表す財務諸表を何というか。　答え：〔<span class="a">貸借対照表</span>〕</p>
<p class="q">Q4. 一定期間の経営成績を表す財務諸表を何というか。　答え：〔<span class="a">損益計算書</span>〕</p>
<p class="q">Q5.「資産＝負債＋純資産」で表される等式を何というか。　答え：〔<span class="a">貸借対照表等式</span>〕</p>
<p class="foot">Kiokumate — App Review sample PDF. © tkdevlab</p>
</body></html>`;

const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.pdf({
    path: out,
    format: "A4",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  const kb = (statSync(out).size / 1024).toFixed(1);
  console.log(`OK wrote ${out} (${kb} KB) using ${executablePath}`);
} finally {
  await browser.close();
}
