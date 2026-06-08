// Bulk read of an account's generated questions for a book (Pro+ only). Used to restore / sync the
// quiz set onto another device. D1 is the single source of truth for synced questions. Standard
// keeps its questions LOCAL (never stored here), so this returns an empty list for Standard.
import { json, type Fn } from "../../_lib/types";
import { getTier } from "../../_lib/tier";

export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  const bookId = new URL(ctx.request.url).searchParams.get("bookId") ?? "";
  if (!bookId) return json({ error: "bookId_required" }, 400);
  const tier = await getTier(ctx.env, uid, ctx.data.email);
  if (!(tier === "pro" || tier === "admin")) return json({ questions: [] }); // Standard: local only
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, book_id, page_index, statement, answer, explanation, source, created_at FROM questions WHERE uid = ? AND book_id = ? ORDER BY page_index, created_at",
  )
    .bind(uid, bookId)
    .all();
  return json({ questions: results });
};
