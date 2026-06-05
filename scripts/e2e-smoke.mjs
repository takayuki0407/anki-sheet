// Temporary browser E2E smoke: drives the built app in Edge, imports the real PDF,
// creates a deck, runs a review card, the viewer, the tuner, and a backup. Not part
// of the app.
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

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1400, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console.error: " + m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
});

try {
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await waitText(page, "デッキ", 30000);
  console.log("OK: app loaded");

  await clickByText(page, "button", "PDFを取り込む");
  await page.waitForSelector("input[type=file]", { timeout: 10000 });
  const input = await page.$("input[type=file]");
  await input.uploadFile(PDF);
  console.log("uploaded PDF, detecting…");

  await waitText(page, "個の語句を検出", 240000);
  const count = await page.$eval(".big-count", (el) => el.innerText.replace(/\s+/g, " ").trim());
  console.log("OK: detection ->", count);

  await clickByText(page, "button", "このデッキを作成");
  await page.waitForSelector(".deck-card", { timeout: 30000 });
  await waitText(page, "新規 3", 30000); // wait until counts load (non-zero new)
  console.log("OK: deck created");

  await page.click(".deck-main"); // navigates regardless of button-enabled state
  await new Promise((r) => setTimeout(r, 3000));
  const reviewText = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log("REVIEW SCREEN TEXT:", JSON.stringify(reviewText));
  await page.screenshot({ path: "e2e-review-state.png" });
  await page.waitForSelector(".page-canvas", { timeout: 30000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector(".page-canvas");
      return c && c.width > 0;
    },
    { timeout: 30000 },
  );
  const maskCount = await page.$$eval(".mask", (els) => els.length);
  console.log("OK: review page rendered, masks =", maskCount);
  await page.screenshot({ path: "e2e-front.png" });

  await clickByText(page, "button", "答えを見る");
  await page.waitForSelector(".grade-row", { timeout: 10000 });
  await page.screenshot({ path: "e2e-back.png" });
  console.log("OK: answer revealed");

  const before = await page.$eval(".review-progress", (e) => e.innerText);
  await clickByText(page, "button", "ふつう");
  await page.waitForFunction(
    (b) => {
      const e = document.querySelector(".review-progress");
      const done = document.body.innerText.includes("セッション完了");
      return done || (e && e.innerText !== b);
    },
    { timeout: 15000 },
    before,
  );
  console.log("OK: graded + advanced");

  // --- red-sheet viewer ---
  await clickByText(page, "button", "終了");
  await page.waitForSelector(".deck-card", { timeout: 15000 });
  await clickByText(page, "button", "めくる");
  await page.waitForSelector(".page-canvas", { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector(".page-canvas")?.width > 0, {
    timeout: 30000,
  });
  const getMasks = () => page.$$eval(".mask", (els) => els.length);
  // Navigate to a page that has answers.
  let m = await getMasks();
  for (let i = 0; i < 8 && m === 0; i++) {
    await clickByText(page, "button", "次 →");
    await new Promise((r) => setTimeout(r, 700));
    m = await getMasks();
  }
  if (m === 0) throw new Error("viewer found no masks across pages");
  console.log("OK: viewer masks (sheet ON) =", m);
  await page.screenshot({ path: "e2e-viewer-on.png" });

  await clickByText(page, "button", "赤シート ON"); // toggle OFF -> reveal all
  await new Promise((r) => setTimeout(r, 400));
  const mOff = await getMasks();
  if (mOff !== 0) throw new Error(`sheet OFF should reveal all, but ${mOff} masks remain`);
  console.log("OK: sheet OFF reveals all answers");
  await page.screenshot({ path: "e2e-viewer-off.png" });

  // --- settings / color tuner ---
  await clickByText(page, "button", "終了");
  await page.waitForSelector(".deck-card", { timeout: 15000 });
  await clickByText(page, "button", "設定");
  await waitText(page, "デッキ設定", 15000);
  await page.waitForSelector(".tuner-preview .page-canvas", { timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelector(".tuner-preview .page-canvas")?.width > 0,
    { timeout: 30000 },
  );
  let hi1 = 0;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 600));
    hi1 = await page.$$eval(".highlight", (els) => els.length);
    if (hi1 > 0) break;
    await clickByText(page, "button", "次 →");
  }
  if (hi1 === 0) throw new Error("tuner found no highlights");
  console.log("OK: tuner preview highlights =", hi1);
  // Move hue far from magenta -> should capture fewer/none. Use the native setter
  // so React's controlled onChange actually fires.
  await page.evaluate(() => {
    const input = document.querySelector(".slider-row input[type=range]");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, "120");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1200));
  const hi2 = await page.$$eval(".highlight", (els) => els.length);
  console.log(
    hi2 < hi1
      ? `OK: hue tuning changed capture ${hi1} -> ${hi2}`
      : `WARN: hue tuning ${hi1} -> ${hi2}`,
  );

  // --- backup export ---
  await clickByText(page, "button", "戻る");
  await page.waitForSelector(".deck-card", { timeout: 15000 });
  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: process.cwd(),
  });
  await clickByText(page, "button", "バックアップを書き出す");
  let bfile = null;
  for (let i = 0; i < 20 && !bfile; i++) {
    await new Promise((r) => setTimeout(r, 500));
    bfile = readdirSync(".").find((n) => n.startsWith("anki-sheet-backup-") && n.endsWith(".json"));
  }
  if (!bfile) throw new Error("backup not downloaded");
  const parsed = JSON.parse(readFileSync(bfile, "utf8"));
  if (parsed.app !== "anki-sheet" || !parsed.pdfs?.length) throw new Error("backup invalid");
  console.log(`OK: backup exported (decks=${parsed.decks.length}, cards=${parsed.cards.length})`);
  rmSync(bfile);

  console.log(errors.length ? "CONSOLE ERRORS:\n" + errors.join("\n") : "no console errors");
  console.log("SMOKE PASS");
} catch (e) {
  console.error("SMOKE FAIL:", e.message);
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
