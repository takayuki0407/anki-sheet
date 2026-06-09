// Resolve a downgrade trim. The user picks the books to KEEP (the kept set); the server makes it
// authoritative across the whole account. Kept books stay 'active'; the rest become 'retained' (R2
// copy KEPT — restorable on re-Pro) when they have a cloud file, else 'trimmed'. Clears
// users.trim_required. Each device then follows the active set on its next sync (deleting local
// copies of non-active books). Devices don't need to be online at the same time.
import { json, type Fn } from "../../_lib/types";
import { getTier, limitFor } from "../../_lib/tier";

export const onRequestPost: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  let body: { keep?: unknown };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const keep = Array.isArray(body.keep)
    ? body.keep.filter((b): b is string => typeof b === "string" && b.length > 0)
    : [];

  const tier = await getTier(ctx.env, uid, ctx.data.email);
  const cap = limitFor(tier);
  if (keep.length > cap) return json({ error: "too_many", cap }, 400);

  if (keep.length) {
    const ph = keep.map(() => "?").join(",");
    await ctx.env.DB.prepare(
      `UPDATE books SET status='active' WHERE uid=? AND book_id IN (${ph})`,
    )
      .bind(uid, ...keep)
      .run();
    await ctx.env.DB.prepare(
      `UPDATE books SET status = CASE WHEN size > 0 THEN 'retained' ELSE 'trimmed' END
       WHERE uid=? AND book_id NOT IN (${ph})`,
    )
      .bind(uid, ...keep)
      .run();
  } else {
    await ctx.env.DB.prepare(
      "UPDATE books SET status = CASE WHEN size > 0 THEN 'retained' ELSE 'trimmed' END WHERE uid=?",
    )
      .bind(uid)
      .run();
  }
  await ctx.env.DB.prepare("UPDATE users SET trim_required=0 WHERE uid=?").bind(uid).run();
  return json({ ok: true, kept: keep.length });
};
