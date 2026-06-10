// SM-2 review-state sync (機能拡張 §A-2/§D-3). Premium-only — SRS ("今日の復習") is the Premium
// feature; Free/Standard/Pro keep their answer history local-only. Trial users carry the premium
// entitlement while the trial runs, so they pass this gate too.
//
//   GET  /api/sync/reviews             → all of this account's review records
//   POST /api/sync/reviews             → batch upsert, per-key (question_id) LWW on updated_at
//
// The LWW lives in the SQL (ON CONFLICT ... WHERE excluded.updated_at > reviews.updated_at), so
// concurrent pushes from two devices converge without read-modify-write races. Orphan cleanup
// (question deleted / regenerated) happens at the deletion sites, not here.
import { json, type Fn } from "../../_lib/types";
import { getTier } from "../../_lib/tier";

function premiumOk(tier: string): boolean {
  return tier === "premium" || tier === "admin";
}

export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!premiumOk(await getTier(ctx.env, uid, ctx.data.email)))
    return json({ error: "premium_required" }, 403);
  const { results } = await ctx.env.DB.prepare(
    "SELECT question_id, ease, interval_d, reps, lapses, due_at, last_at, last_ok, updated_at FROM reviews WHERE uid = ?",
  )
    .bind(uid)
    .all();
  return json({ reviews: results });
};

interface InReview {
  question_id?: unknown;
  ease?: unknown;
  interval_d?: unknown;
  reps?: unknown;
  lapses?: unknown;
  due_at?: unknown;
  last_at?: unknown;
  last_ok?: unknown;
  updated_at?: unknown;
}

export const onRequestPost: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!premiumOk(await getTier(ctx.env, uid, ctx.data.email)))
    return json({ error: "premium_required" }, 403);
  let body: { reviews?: unknown };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const list = Array.isArray(body.reviews) ? (body.reviews as InReview[]) : [];
  const rows = list.filter(
    (r) =>
      r &&
      typeof r.question_id === "string" &&
      r.question_id &&
      typeof r.ease === "number" &&
      typeof r.interval_d === "number" &&
      typeof r.reps === "number" &&
      typeof r.lapses === "number" &&
      typeof r.due_at === "number" &&
      typeof r.last_at === "number" &&
      (r.last_ok === 0 || r.last_ok === 1) &&
      typeof r.updated_at === "number",
  );
  if (!rows.length) return json({ ok: true, upserted: 0 });
  await ctx.env.DB.batch(
    rows.map((r) =>
      ctx.env.DB.prepare(
        `INSERT INTO reviews (uid, question_id, ease, interval_d, reps, lapses, due_at, last_at, last_ok, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uid, question_id) DO UPDATE SET
           ease = excluded.ease, interval_d = excluded.interval_d, reps = excluded.reps,
           lapses = excluded.lapses, due_at = excluded.due_at, last_at = excluded.last_at,
           last_ok = excluded.last_ok, updated_at = excluded.updated_at
         WHERE excluded.updated_at > reviews.updated_at`,
      ).bind(
        uid,
        r.question_id,
        r.ease,
        r.interval_d,
        r.reps,
        r.lapses,
        r.due_at,
        r.last_at,
        r.last_ok,
        r.updated_at,
      ),
    ),
  );
  return json({ ok: true, upserted: rows.length });
};
