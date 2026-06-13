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

  // Stale-screen guard FIRST: if the trim is no longer required — e.g. the user re-upgraded to Pro
  // while the trim screen was open (the webhook already cleared the flag and reactivated retained
  // books) — a late submit must NOT demote anything (nor fail on the now-unlimited cap).
  const u = await ctx.env.DB.prepare("SELECT trim_required FROM users WHERE uid = ?")
    .bind(uid)
    .first<{ trim_required: number }>();
  if (!u?.trim_required) return json({ ok: true, kept: 0, skipped: true });

  const tier = await getTier(ctx.env, uid, ctx.data.email);
  const cap = limitFor(tier);
  if (keep.length > cap) return json({ error: "too_many", cap }, 400);

  // The trim chooses among the CURRENTLY ACTIVE books only. Validating against that set blocks two
  // failure modes: (a) a stale/buggy client "keeping" a retained/trimmed book and resurrecting it
  // (a 'trimmed' book has no data anywhere — it would become an unusable ghost that eats a slot),
  // and (b) the catastrophic empty-keep submit (a client whose book list failed to load showing
  // 「選んだ 0 冊を残す」) demoting the entire library.
  const activeRows = await ctx.env.DB.prepare(
    "SELECT book_id FROM books WHERE uid = ? AND status = 'active'",
  )
    .bind(uid)
    .all<{ book_id: string }>();
  const activeIds = new Set(activeRows.results.map((r) => r.book_id));
  if (keep.some((id) => !activeIds.has(id))) return json({ error: "invalid_keep" }, 400);
  if (activeIds.size > 0 && keep.length === 0) return json({ error: "empty_keep" }, 400);

  if (activeIds.size > 0) {
    const now = Date.now();
    // Demote everything active that wasn't kept. Mirrors retain.ts: the holder stamp is cleared
    // (no device holds a retired book — local copies get deleted on each device's reconcile) and
    // updated_at is bumped.
    const ph = keep.length ? keep.map(() => "?").join(",") : "''";
    await ctx.env.DB.prepare(
      `UPDATE books SET status = CASE WHEN size > 0 THEN 'retained' ELSE 'trimmed' END,
         device = NULL, updated_at = ?
       WHERE uid = ? AND status = 'active' AND book_id NOT IN (${ph})`,
    )
      .bind(now, uid, ...keep)
      .run();
  }
  await ctx.env.DB.prepare("UPDATE users SET trim_required = 0 WHERE uid = ?").bind(uid).run();
  return json({ ok: true, kept: keep.length });
};
