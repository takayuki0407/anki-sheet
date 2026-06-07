// Unregister a book (frees an account-global slot). Idempotent. The Pro PDF blob in R2, if any,
// is removed here too once R2 is wired up (TODO).
import { json, type Fn } from "../../../_lib/types";

export const onRequestDelete: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  const bookId = ctx.params.bookId;
  if (ctx.env.PDFS) {
    await ctx.env.PDFS.delete(`${uid}/${bookId}.pdf`); // PDF blob
    await ctx.env.PDFS.delete(`${uid}/${bookId}.json`); // deck content
  }
  await ctx.env.DB.prepare("DELETE FROM books WHERE uid = ? AND book_id = ?").bind(uid, bookId).run();
  await ctx.env.DB.prepare("DELETE FROM progress WHERE uid = ? AND book_id = ?").bind(uid, bookId).run();
  return json({ ok: true });
};
