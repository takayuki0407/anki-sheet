// Push/read one book's progress (opaque JSON: revealed ids, page position, redMode, band, …).
// Last-write-wins by updated_at on the client side. Pro-only.
import { json, type Fn } from "../../../_lib/types";
import { getTier, isUnlimited } from "../../../_lib/tier";

export const onRequestPut: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!isUnlimited(await getTier(ctx.env, uid, ctx.data.email)))
    return json({ error: "pro_required" }, 403);
  let body: { data?: unknown };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const data = JSON.stringify(body?.data ?? {});
  await ctx.env.DB.prepare(
    `INSERT INTO progress (uid, book_id, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(uid, book_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(uid, ctx.params.bookId, data, Date.now())
    .run();
  return json({ ok: true });
};

export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!isUnlimited(await getTier(ctx.env, uid, ctx.data.email)))
    return json({ error: "pro_required" }, 403);
  const row = await ctx.env.DB.prepare(
    "SELECT data, updated_at FROM progress WHERE uid = ? AND book_id = ?",
  )
    .bind(uid, ctx.params.bookId)
    .first();
  if (!row) return json({ error: "not_found" }, 404);
  return json(row);
};
