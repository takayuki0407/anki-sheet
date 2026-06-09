// AI true/false (○×) question generation (phase 1). Under /api/sync/* so the auth middleware
// injects ctx.data.uid. The ANTHROPIC_API_KEY is a SERVER secret — never sent to clients.
//
//   GET  /api/sync/generate            → this account's current month quota (count/limit/remaining)
//   POST /api/sync/generate            → generate (or return cached) questions for one page
//
// Quota ("page budget") is enforced SERVER-SIDE per tier (Standard 10 / Pro 30 / admin ∞ per month).
// Pro+ questions are stored in D1 (synced + the re-display cache); Standard questions are returned
// only and kept LOCAL by the client (this endpoint never persists Standard rows).
import { json, type Fn } from "../../_lib/types";
import { genLimitDuringTrial, getTierAndTrial, isUnlimited } from "../../_lib/tier";

const HARD_MAX = 6;
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1500;
const MAX_PAGE_TEXT = 8000; // cap input text to bound cost on very dense pages
const CONTEXT_CHARS = 700; // cap for each neighbor-page reference excerpt (input-only, see §修正③)
const DENSITY_MAX: Record<string, number> = { few: 2, normal: 4, many: 6, auto: HARD_MAX };

/** Current YYYY-MM (UTC) — the quota period key. */
function period(): string {
  return new Date().toISOString().slice(0, 7);
}

const SYSTEM_PROMPT = `あなたは暗記学習用の正誤問題（○×）出題エンジンです。学習者の教材ページの「本文」と、
赤シートで隠す対象としてマークされた「答えの語句」が与えられます。これらから正誤問題を作ります。

科目は一切問いません（世界史・化学・英単語、社労士・公認会計士・司法試験など何でも）。
特定分野の知識を前提にせず、与えられた本文だけを根拠にすること。

# 厳守ルール
1. 言語：問題・解説は本文と同じ言語で書く。語学教材（英単語など）は語→訳・訳→語の双方向可。
2. 出題の核心：マークされた語句が、学習者が覚えるべき答え。これらを問う。
3. 根拠：本文に明示された情報だけを使う。外部知識の追加・推測をしない。本文から確実に判断
   できない事項は出題しない（誤った「正解」を出すことは絶対に避ける）。本文の前後に
   【前ページ末尾】【次ページ冒頭】が参考として付くことがある。これは本ページ語句の意味を
   補うための参考に過ぎず、出題は本ページのマーク語句のみ。参考文脈にしか登場しない語句は
   出題しない。
4. 正文と誤文をおおむね半々で作り、順序はランダムにする（答えが偏って予測されないように）。
5. 正文：本文を別の言い回しに言い換えた、すべて正しい文。マークされた事実は正確に保つ。
6. 誤文：正しい文のうち、マーク語句を1か所だけ、もっともらしい同種の別の語に置き換えて
   誤りにする。誤りは1文に1か所だけ。残りはすべて正しく保つ。置換先は同じページの他のマーク
   語句や明らかな同類（他の年号・人物・地名・化合物・数値・要件・訳語など）から取り、突飛な
   誤りにしない。
7. 各文は本文に照らして「正」か「誤」が一意に決まること。曖昧・部分的に正しい文は作らない。
8. 問題数：「おまかせ」はマーク語句の数に応じて決める（目安2〜3語句につき1問、最少2問、
   最大{HARD_MAX}問）。具体的な数が指定された場合はその数に合わせる（ただし{HARD_MAX}問を超えない）。
   重複を避け、異なる論点を優先して網羅する。
9. マーク語句は改行をまたぐことがある。意味のまとまりとして1つに扱う。
10. 各問に1文の簡潔な解説を付ける。誤文では正しい値も示す。
11. 出力はJSON配列のみ。前後に説明文・コードフェンス・余計な文字を付けない。

# 出力スキーマ（JSON配列）
[
  {
    "statement": "正誤を判定する記述文",
    "answer": "正" | "誤",
    "explanation": "1文の解説（誤文では正しい値を示す）",
    "source": "根拠にしたマーク語句"
  }
]`.replaceAll("{HARD_MAX}", String(HARD_MAX));

interface RawQ {
  statement?: unknown;
  answer?: unknown;
  explanation?: unknown;
  source?: unknown;
}
interface OutQ {
  id: string;
  pageIndex: number;
  statement: string;
  answer: "正" | "誤";
  explanation: string;
  source: string;
}

function buildUserMessage(
  subjectHint: string,
  maxN: number,
  pageText: string,
  terms: string[],
  prevContext: string,
  nextContext: string,
): string {
  const lines = [
    `【科目ヒント】${subjectHint.trim() || "指定なし（本文から判断）"}`,
    `【最大問数】${maxN}`,
    ``,
  ];
  // Neighbor-page excerpts are REFERENCE only (resolve definitions/sentences split across a page
  // boundary); questions still come from THIS page's marked terms. Omitted when empty (first/last page).
  if (prevContext.trim()) {
    lines.push(`【前ページ末尾（参考・出題対象外）】`, prevContext.slice(-CONTEXT_CHARS).trim(), ``);
  }
  lines.push(
    `【本ページ本文（この範囲のマーク語句のみ出題）】`,
    pageText.slice(0, MAX_PAGE_TEXT).trim(),
    ``,
  );
  if (nextContext.trim()) {
    lines.push(`【次ページ冒頭（参考・出題対象外）】`, nextContext.slice(0, CONTEXT_CHARS).trim(), ``);
  }
  lines.push(
    `【マークされた答え（赤シート対象・改行をまたぐ場合あり）】`,
    ...terms.map((t) => `- ${t}`),
  );
  return lines.join("\n");
}

/** Parse the model's JSON array, salvaging a truncated array by keeping complete objects. */
function tolerantParse(text: string): RawQ[] {
  const t = text.trim();
  try {
    return JSON.parse(t) as RawQ[];
  } catch {
    /* try to salvage a cut-off array */
  }
  const last = t.lastIndexOf("}");
  if (last > 0) {
    try {
      return JSON.parse(t.slice(0, last + 1) + "]") as RawQ[];
    } catch {
      /* give up */
    }
  }
  throw new Error("unparseable_model_output");
}

/** Call Haiku with an assistant "[" prefill so the output is a JSON array from the first token. */
async function callHaiku(apiKey: string, userMessage: string): Promise<RawQ[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userMessage },
        { role: "assistant", content: "[" }, // prefill → forces a JSON array, no retry needed
      ],
    }),
  });
  if (!res.ok) throw new Error(`anthropic_${res.status}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = "[" + (data.content ?? []).map((c) => c.text ?? "").join("");
  return tolerantParse(text);
}

// GET → current month's quota for this account (drives the client's "remaining" UI).
export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  const { tier, trialUntil } = await getTierAndTrial(ctx.env, uid, ctx.data.email);
  const limit = genLimitDuringTrial(tier, trialUntil, Date.now());
  const row = await ctx.env.DB.prepare(
    "SELECT count FROM generation_usage WHERE uid = ? AND period = ?",
  )
    .bind(uid, period())
    .first<{ count: number }>();
  const count = row?.count ?? 0;
  return json({
    tier,
    period: period(),
    count,
    limit,
    remaining: Math.max(0, limit - count),
    unlimited: limit >= Number.MAX_SAFE_INTEGER,
  });
};

export const onRequestPost: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!ctx.env.ANTHROPIC_API_KEY) return json({ error: "ai_not_configured" }, 503);

  let body: {
    bookId?: string;
    pageIndex?: number;
    pageText?: string;
    markedTerms?: unknown;
    density?: string;
    subjectHint?: string;
    regenerate?: boolean;
    prevContext?: string;
    nextContext?: string;
  };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const bookId = typeof body.bookId === "string" ? body.bookId : "";
  const pageIndex = typeof body.pageIndex === "number" ? body.pageIndex : NaN;
  if (!bookId || !Number.isFinite(pageIndex)) return json({ error: "bad_request" }, 400);

  const terms = Array.isArray(body.markedTerms)
    ? (body.markedTerms.filter((t) => typeof t === "string" && t.trim()) as string[])
    : [];
  if (!terms.length) return json({ error: "no_terms", questions: [] }); // nothing to ask → no quota
  if (typeof body.pageText !== "string" || !body.pageText.trim())
    return json({ error: "no_text" }, 422);

  const { tier, trialUntil } = await getTierAndTrial(ctx.env, uid, ctx.data.email);
  const isProPlus = isUnlimited(tier); // pro / premium / admin → questions stored in D1 (synced)

  // Cache: Pro+ re-display of an already-generated page returns the stored set (no quota, no API).
  // Standard manages its cache locally and only calls this for ungenerated pages.
  if (!body.regenerate && isProPlus) {
    const cached = await ctx.env.DB.prepare(
      "SELECT id, page_index, statement, answer, explanation, source FROM questions WHERE uid = ? AND book_id = ? AND page_index = ? ORDER BY created_at",
    )
      .bind(uid, bookId, pageIndex)
      .all<OutQ>();
    if (cached.results.length) return json({ questions: cached.results, cached: true });
  }

  // Quota (server-authoritative). During the 7-day trial the budget is capped (§1.4). RESERVE a slot
  // atomically BEFORE the API call (conditional +1) so concurrent requests can't double-spend the
  // monthly budget; a failed/empty generation refunds the slot below (we eat the API cost, not the
  // user's quota).
  const limit = genLimitDuringTrial(tier, trialUntil, Date.now());
  const p = period();
  const reserve = await ctx.env.DB.prepare(
    `INSERT INTO generation_usage (uid, period, count) VALUES (?, ?, 1)
     ON CONFLICT(uid, period) DO UPDATE SET count = count + 1 WHERE generation_usage.count < ?`,
  )
    .bind(uid, p, limit)
    .run();
  if ((reserve.meta?.changes ?? 0) === 0) {
    const usedRow = await ctx.env.DB.prepare(
      "SELECT count FROM generation_usage WHERE uid = ? AND period = ?",
    )
      .bind(uid, p)
      .first<{ count: number }>();
    return json({ error: "quota_exceeded", count: usedRow?.count ?? limit, limit }, 402);
  }
  const refund = () =>
    ctx.env.DB.prepare(
      "UPDATE generation_usage SET count = count - 1 WHERE uid = ? AND period = ? AND count > 0",
    )
      .bind(uid, p)
      .run();

  const maxN = DENSITY_MAX[body.density ?? "auto"] ?? HARD_MAX;
  const prevContext = typeof body.prevContext === "string" ? body.prevContext : "";
  const nextContext = typeof body.nextContext === "string" ? body.nextContext : "";
  const userMessage = buildUserMessage(
    body.subjectHint ?? "",
    maxN,
    body.pageText,
    terms,
    prevContext,
    nextContext,
  );

  // Generate. A failed/garbage generation refunds the reserved slot (the user isn't charged quota).
  let raw: RawQ[];
  try {
    raw = await callHaiku(ctx.env.ANTHROPIC_API_KEY, userMessage);
  } catch (e) {
    await refund();
    return json({ error: "ai_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
  const valid: OutQ[] = raw
    .filter(
      (q) =>
        q &&
        (q.answer === "正" || q.answer === "誤") &&
        typeof q.statement === "string" &&
        q.statement.trim(),
    )
    .slice(0, maxN)
    .map((q) => ({
      id: crypto.randomUUID(),
      pageIndex,
      statement: String(q.statement).trim(),
      answer: q.answer as "正" | "誤",
      explanation: typeof q.explanation === "string" ? q.explanation : "",
      source: typeof q.source === "string" ? q.source : "",
    }));
  if (!valid.length) {
    await refund();
    return json({ error: "empty_generation" }, 422);
  }
  // (The slot was already reserved atomically above; no second increment.)

  // Pro+: replace this page's stored set (delete + insert in one batch). Standard: return only.
  if (isProPlus) {
    const now = Date.now();
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        "DELETE FROM questions WHERE uid = ? AND book_id = ? AND page_index = ?",
      ).bind(uid, bookId, pageIndex),
      ...valid.map((q) =>
        ctx.env.DB.prepare(
          "INSERT INTO questions (id, uid, book_id, page_index, statement, answer, explanation, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(q.id, uid, bookId, pageIndex, q.statement, q.answer, q.explanation, q.source, now),
      ),
    ]);
  }

  // Read back the reserved count for an accurate remaining (the slot was incremented up-front).
  const nowRow = await ctx.env.DB.prepare(
    "SELECT count FROM generation_usage WHERE uid = ? AND period = ?",
  )
    .bind(uid, p)
    .first<{ count: number }>();
  const count = nowRow?.count ?? limit;
  return json({ questions: valid, count, limit, remaining: Math.max(0, limit - count) });
};
