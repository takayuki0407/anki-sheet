// Admin-only test helper — set the CALLER's own tier (+ downgraded_at) so the developer can
// exercise plan behavior (the Standard per-device limit, the forced-trim downgrade, Pro cloud
// sync, the 6-month retention job) WITHOUT a live RevenueCat subscription.
//
// Gated to the admin email taken from the VERIFIED Firebase token (not client-supplied), so it is
// safe even in production: no other account can change a tier. The chosen tier is stored in
// users.tier and honored by getTier (an explicit row wins, even for the admin — see _lib/tier.ts).
import { json, type Fn } from "../../../_lib/types";

export const onRequestPost: Fn = async (ctx) => {
  const email = ctx.data.email;
  const isAdmin =
    !!email &&
    !!ctx.env.ADMIN_EMAIL &&
    email.toLowerCase() === ctx.env.ADMIN_EMAIL.toLowerCase();
  if (!isAdmin) return json({ error: "admin_only" }, 403);

  let body: { tier?: string; downgradedAt?: number | null };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const tier = body.tier;
  if (tier !== "standard" && tier !== "pro" && tier !== "admin")
    return json({ error: "bad_tier" }, 400);

  const now = Date.now();
  // downgraded_at: use an explicit override when provided (a backdated number to test the 6-month
  // retention, or null to clear); otherwise default — Pro clears the clock, a non-Pro tier starts
  // it now.
  let downgradedAt: number | null;
  if (Object.prototype.hasOwnProperty.call(body, "downgradedAt")) {
    downgradedAt = body.downgradedAt === null ? null : Number(body.downgradedAt);
  } else {
    downgradedAt = tier === "pro" ? null : now;
  }

  await ctx.env.DB.prepare(
    `INSERT INTO users (uid, tier, updated_at, downgraded_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       tier = excluded.tier, updated_at = excluded.updated_at, downgraded_at = excluded.downgraded_at`,
  )
    .bind(ctx.data.uid, tier, now, downgradedAt)
    .run();

  return json({ ok: true, tier, downgradedAt });
};
