// Unregister a book (frees an account-global slot). Idempotent. The Pro PDF blob in R2, if any,
// is removed here too once R2 is wired up (TODO).
// PATCH updates per-book account state shared across devices: favorite (pinned) + opened_at (the
// last-opened time; merged as MAX so the most recent open across devices wins). No-op when the
// book isn't registered for this account; not tier-gated (cheap D1 metadata on an existing row).
import { json, type Fn } from "../../../_lib/types";

export const onRequestPatch: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  const bookId = ctx.params.bookId;
  let body: { favorite?: boolean; opened_at?: number };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const sets: string[] = [];
  const binds: (number | string)[] = [];
  if (typeof body.favorite === "boolean") {
    sets.push("favorite = ?");
    binds.push(body.favorite ? 1 : 0);
  }
  if (typeof body.opened_at === "number" && body.opened_at > 0) {
    sets.push("opened_at = MAX(opened_at, ?)");
    binds.push(body.opened_at);
  }
  if (!sets.length) return json({ ok: true });
  binds.push(uid, bookId);
  await ctx.env.DB.prepare(`UPDATE books SET ${sets.join(", ")} WHERE uid = ? AND book_id = ?`)
    .bind(...binds)
    .run();
  return json({ ok: true });
};

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
