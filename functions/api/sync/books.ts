// Account-global book registry. GET lists the account's books (+ count/limit/tier/device); POST
// reserves a slot for a new book, enforcing the tier cap ACROSS ALL DEVICES. For Standard only
// the slot is reserved (no file). Pro/admin are unlimited. `device` is a friendly label of the
// device that imported the book, surfaced in the over-limit chooser.
import { json, type Fn } from "../../_lib/types";
import { getTier, isUnlimited, limitFor } from "../../_lib/tier";

export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  const tier = await getTier(ctx.env, uid, ctx.data.email);
  const { results } = await ctx.env.DB.prepare(
    "SELECT book_id, name, size, page_count, device, updated_at, favorite, opened_at FROM books WHERE uid = ? ORDER BY updated_at DESC",
  )
    .bind(uid)
    .all();
  return json({
    books: results,
    count: results.length,
    limit: limitFor(tier),
    tier,
    unlimited: isUnlimited(tier),
  });
};

export const onRequestPost: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  let body: {
    book_id?: string;
    name?: string;
    size?: number;
    page_count?: number;
    device?: string;
  };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const bookId = typeof body.book_id === "string" ? body.book_id : "";
  if (!bookId) return json({ error: "book_id_required" }, 400);

  // Per-device limit (client-enforced): the account-global registry no longer caps the count —
  // each device limits its OWN local library to the tier's allowance (Standard = 10/device). The
  // registry just tracks books (+ device labels + Pro cloud files), so registration never 403s here.
  await ctx.env.DB.prepare(
    `INSERT INTO books (uid, book_id, name, size, page_count, device, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid, book_id) DO UPDATE SET
       name = excluded.name, size = excluded.size, page_count = excluded.page_count,
       device = excluded.device, updated_at = excluded.updated_at`,
  )
    .bind(
      uid,
      bookId,
      String(body.name ?? ""),
      Number(body.size) || 0,
      Number(body.page_count) || 0,
      typeof body.device === "string" ? body.device : null,
      Date.now(),
    )
    .run();
  return json({ ok: true });
};
