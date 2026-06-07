// RevenueCat webhook → keep users.tier in sync with the subscription so real Pro subscribers are
// honored server-side (admin stays unlimited by email regardless). RC POSTs subscription events
// here with an Authorization header you set in the RC dashboard, which must equal the
// RC_WEBHOOK_SECRET Pages secret. `app_user_id` is the Firebase uid (set via Purchases.logIn).
// NOTE: not yet validated against live RC traffic — activate when RevenueCat is configured.
import { json, type Fn } from "../../_lib/types";

// Events that grant/maintain access vs. revoke it. CANCELLATION / BILLING_ISSUE keep current
// access (the user keeps Pro until it actually EXPIRES).
const GRANT = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
]);
const REVOKE = new Set(["EXPIRATION"]);

export const onRequestPost: Fn = async (ctx) => {
  const secret = ctx.env.RC_WEBHOOK_SECRET;
  if (!secret || ctx.request.headers.get("Authorization") !== secret)
    return json({ error: "unauthorized" }, 401);

  let body: { event?: { app_user_id?: string; type?: string; entitlement_ids?: string[] } };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const e = body.event;
  if (!e?.app_user_id || !e.type) return json({ ok: true }); // not an event we act on

  let tier: "standard" | "pro" | null = null;
  if (GRANT.has(e.type)) tier = (e.entitlement_ids ?? []).includes("pro") ? "pro" : "standard";
  else if (REVOKE.has(e.type)) tier = "standard";
  if (tier === null) return json({ ok: true }); // e.g. CANCELLATION — keep current access

  await ctx.env.DB.prepare(
    `INSERT INTO users (uid, tier, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET tier = excluded.tier, updated_at = excluded.updated_at`,
  )
    .bind(e.app_user_id, tier, Date.now())
    .run();
  return json({ ok: true });
};
