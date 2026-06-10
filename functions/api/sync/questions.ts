// Bulk read of an account's generated questions for a book (Pro+ only). Used to restore / sync the
// quiz set onto another device. D1 is the single source of truth for synced questions. Standard
// keeps its questions LOCAL (never stored here), so this returns an empty list for Standard.
import { json, type Fn } from "../../_lib/types";
import { getTier, isUnlimited } from "../../_lib/tier";

export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  const bookId = new URL(ctx.request.url).searchParams.get("bookId") ?? "";
  if (!bookId) return json({ error: "bookId_required" }, 400);
  const tier = await getTier(ctx.env, uid, ctx.data.email);
  if (!isUnlimited(tier)) return json({ questions: [] }); // Free/Standard: questions are local-only
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, book_id, page_index, qtype, statement, answer, choices, explanation, source, created_at FROM questions WHERE uid = ? AND book_id = ? ORDER BY page_index, created_at",
  )
    .bind(uid, bookId)
    .all<{ choices: string | null } & Record<string, unknown>>();
  return json({
    questions: results.map((q) => ({ ...q, choices: q.choices ? JSON.parse(q.choices) : null })),
  });
};

// Delete one (page × type) question group + its reviews (問題一覧の削除). No tier gate — an
// account may always delete its own rows (Standard simply has none here).
export const onRequestDelete: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  const url = new URL(ctx.request.url);
  const bookId = url.searchParams.get("bookId") ?? "";
  const pageIndex = Number(url.searchParams.get("pageIndex"));
  const qtype = url.searchParams.get("qtype") ?? "";
  if (!bookId || !Number.isFinite(pageIndex) || (qtype !== "tf" && qtype !== "mc4"))
    return json({ error: "bad_request" }, 400);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      "DELETE FROM reviews WHERE uid = ? AND question_id IN (SELECT id FROM questions WHERE uid = ? AND book_id = ? AND page_index = ? AND qtype = ?)",
    ).bind(uid, uid, bookId, pageIndex, qtype),
    ctx.env.DB.prepare(
      "DELETE FROM questions WHERE uid = ? AND book_id = ? AND page_index = ? AND qtype = ?",
    ).bind(uid, bookId, pageIndex, qtype),
  ]);
  return json({ ok: true });
};
