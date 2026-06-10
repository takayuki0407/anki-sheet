// DELETE permanently removes a book from the account's CLOUD: its R2 objects (PDF blob + content
// JSON), the registry row, and its progress. This is the deliberate「クラウドから削除」action — a
// plain bookshelf delete is LOCAL-only and must NOT call it, so the cloud master survives for other
// devices + re-download. Idempotent.
// PATCH updates per-book account state shared across devices: favorite (pinned) + opened_at (the
// last-opened time; merged as MAX so the most recent open across devices wins). No-op when the
// book isn't registered for this account; not tier-gated (cheap D1 metadata on an existing row).
import { json, type Fn } from "../../../_lib/types";

export const onRequestPatch: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  const bookId = ctx.params.bookId;
  let body: { favorite?: boolean; opened_at?: number; device?: string | null };
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
  // The device that currently HOLDS the book stamps its (user-editable) name here — on download and
  // on rename — so the cloud list shows where a book is now, not just who first imported it. An
  // explicit empty/null device CLEARS the holder (the holder deleted its local copy → the book is
  // now cloud-only, held by no device).
  if (typeof body.device === "string" && body.device.trim()) {
    sets.push("device = ?");
    binds.push(body.device.trim());
  } else if (body.device === "" || body.device === null) {
    sets.push("device = NULL");
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
  // Reviews reference questions by id — clear them BEFORE the questions rows vanish (subquery).
  await ctx.env.DB.prepare(
    "DELETE FROM reviews WHERE uid = ? AND question_id IN (SELECT id FROM questions WHERE uid = ? AND book_id = ?)",
  )
    .bind(uid, uid, bookId)
    .run();
  await ctx.env.DB.prepare("DELETE FROM questions WHERE uid = ? AND book_id = ?").bind(uid, bookId).run();
  return json({ ok: true });
};
