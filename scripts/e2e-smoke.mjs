// Temporary browser E2E smoke: drives the built app in Edge through import + the
// red-sheet viewer (masks, sheet toggle, zoom, pagination, 目次) + tuner + backup.
import puppeteer from "puppeteer-core";
import { readdirSync, readFileSync, rmSync } from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.SMOKE_URL || "http://localhost:4178/";
const PDF = process.env.ANKI_SHEET_TEST_PDF;
if (!PDF) throw new Error("set ANKI_SHEET_TEST_PDF");

const clickByText = (page, tag, text) =>
  page.evaluate(
    (tag, text) => {
      const el = [...document.querySelectorAll(tag)].find((e) => e.textContent.includes(text));
      if (!el) throw new Error(`no ${tag} containing "${text}"`);
      el.click();
    },
    tag,
    text,
  );
const waitText = (page, text, timeout = 240000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1400, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console.error: " + m.text()));
page.on("response", (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()}: ${r.url()}`));
page.on("dialog", async (d) => {
  if (d.type() === "prompt") await d.accept("テスト章");
  else await d.accept();
});

const masks = () => page.$$eval(".mask", (e) => e.length);
const canvasW = () => page.$eval(".page-canvas", (c) => c.getBoundingClientRect().width);

try {
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await waitText(page, "デッキ", 30000);
  console.log("OK: app loaded");

  await clickByText(page, "button", "PDFを取り込む");
  await page.waitForSelector("input[type=file]", { timeout: 10000 });
  await (await page.$("input[type=file]")).uploadFile(PDF);
  console.log("uploaded PDF, detecting…");
  await waitText(page, "個の語句を検出", 240000);
  const count = await page.$eval(".big-count", (el) => el.innerText.replace(/\s+/g, " ").trim());
  console.log("OK: detection ->", count);

  await clickByText(page, "button", "このデッキを作成");
  await page.waitForSelector(".deck-card", { timeout: 30000 });
  await waitText(page, "個の暗記", 30000);
  await page.screenshot({ path: "e2e-decklist.png" });
  console.log("OK: deck created");

  // --- viewer ---
  await page.click(".deck-main");
  await page.waitForSelector(".page-canvas", { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector(".page-canvas")?.width > 0, { timeout: 30000 });

  // find a page with answers
  let m = await masks();
  for (let i = 0; i < 8 && m === 0; i++) {
    await clickByText(page, "button", "次 →");
    await sleep(700);
    m = await masks();
  }
  if (m === 0) throw new Error("viewer found no masks");
  console.log("OK: viewer masks (sheet ON) =", m);
  await page.screenshot({ path: "e2e-viewer-fit.png" });

  await clickByText(page, "button", "赤シート ON");
  await sleep(400);
  if ((await masks()) !== 0) throw new Error("sheet OFF should reveal all");
  console.log("OK: sheet OFF reveals all");
  await clickByText(page, "button", "赤シート OFF"); // back on
  await sleep(300);

  // zoom
  const w1 = await canvasW();
  await clickByText(page, "button", "＋");
  await sleep(900);
  const w2 = await canvasW();
  if (!(w2 > w1 * 1.1)) throw new Error(`zoom did not enlarge page (${w1}->${w2})`);
  console.log(`OK: zoom enlarged page ${Math.round(w1)} -> ${Math.round(w2)}`);
  await page.screenshot({ path: "e2e-viewer.png" });

  // pagination via number input
  const setPageInput = (v) =>
    page.evaluate((v) => {
      const inp = document.querySelector(".page-input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(inp, v);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }, v);
  const before = await page.$eval(".review-progress", (e) => e.innerText);
  await setPageInput("50");
  await sleep(600);
  const after = await page.$eval(".review-progress", (e) => e.innerText);
  if (after === before || !after.startsWith("50 ")) throw new Error(`page jump failed (${before}->${after})`);
  console.log(`OK: page jump ${before.trim()} -> ${after.trim()}`);

  // 目次: add bookmark at p.50, move away, then jump back via the bookmark
  await clickByText(page, "button", "目次");
  await page.waitForSelector(".drawer", { timeout: 5000 });
  await clickByText(page, "button", "しおりに追加");
  await page.waitForSelector(".toc-item", { timeout: 5000 });
  console.log("OK: bookmark added");
  await clickByText(page, "button", "閉じる");
  await setPageInput("1");
  await sleep(400);
  await clickByText(page, "button", "目次");
  await page.waitForSelector(".toc-jump", { timeout: 5000 });
  await page.click(".toc-jump");
  await sleep(400);
  const jumped = await page.$eval(".review-progress", (e) => e.innerText);
  if (!jumped.startsWith("50 ")) throw new Error("TOC jump failed: " + jumped);
  console.log("OK: TOC jump ->", jumped.trim());

  // --- settings tuner ---
  await clickByText(page, "button", "終了");
  await page.waitForSelector(".deck-card", { timeout: 15000 });
  await clickByText(page, "button", "設定");
  await waitText(page, "デッキ設定", 15000);
  await page.waitForSelector(".tuner-preview .page-canvas", { timeout: 30000 });
  let hi = 0;
  for (let i = 0; i < 6 && hi === 0; i++) {
    for (let j = 0; j < 5 && hi === 0; j++) {
      await sleep(500);
      hi = await page.$$eval(".highlight", (e) => e.length);
    }
    if (hi === 0) await clickByText(page, "button", "次 →");
  }
  if (hi === 0) throw new Error("tuner found no highlights");
  console.log("OK: tuner highlights =", hi);

  // --- backup export ---
  await clickByText(page, "button", "戻る");
  await page.waitForSelector(".deck-card", { timeout: 15000 });
  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: process.cwd() });
  await clickByText(page, "button", "バックアップを書き出す");
  let bfile = null;
  for (let i = 0; i < 20 && !bfile; i++) {
    await sleep(500);
    bfile = readdirSync(".").find((n) => n.startsWith("anki-sheet-backup-") && n.endsWith(".json"));
  }
  if (!bfile) throw new Error("backup not downloaded");
  const parsed = JSON.parse(readFileSync(bfile, "utf8"));
  if (parsed.app !== "anki-sheet" || !parsed.cards?.length) throw new Error("backup invalid");
  console.log(`OK: backup (cards=${parsed.cards.length}, bookmarks=${parsed.bookmarks?.length ?? 0})`);
  rmSync(bfile);

  console.log(errors.length ? "NOTE errors:\n" + errors.join("\n") : "no console errors");
  console.log("SMOKE PASS");
} catch (e) {
  console.error("SMOKE FAIL:", e.message);
  if (errors.length) console.error(errors.join("\n"));
  await page.screenshot({ path: "e2e-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
