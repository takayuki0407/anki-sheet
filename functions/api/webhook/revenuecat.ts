// RevenueCat webhook → keep users.tier in sync with the subscription (admin stays unlimited by email
// regardless). RC POSTs subscription events with an Authorization header equal to RC_WEBHOOK_SECRET.
// `app_user_id` is the Firebase uid (Purchases.logIn). Phase 1: maps to free/standard/pro/premium,
// uses the EVENT timestamp (idempotent against out-of-order/duplicate delivery), and sets a downgrade
// trim flag when the new cap is below the account's active book count.
import { json, type Fn } from "../../_lib/types";
import { isUnlimited, limitFor, type Tier } from "../../_lib/tier";

// Events that grant/maintain access vs. revoke it. CANCELLATION / BILLING_ISSUE keep current access
// (the user keeps their tier until it actually EXPIRES → Free floor).
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

  let body: {
    event?: {
      app_user_id?: string;
      type?: string;
      entitlement_ids?: string[];
      event_timestamp_ms?: number;
    };
  };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const e = body.event;
  if (!e?.app_user_id || !e.type) return json({ ok: true });

  let tier: Tier | null = null;
  if (GRANT.has(e.type)) {
    const ents = e.entitlement_ids ?? [];
    tier = ents.includes("premium") ? "premium" : ents.includes("pro") ? "pro" : "standard";
  } else if (REVOKE.has(e.type)) {
    tier = "free"; // expired subscription → the Free floor (NOT Standard)
  }
  if (tier === null) return json({ ok: true }); // e.g. CANCELLATION — keep current access

  const uid = e.app_user_id;
  const eventTime = typeof e.event_timestamp_ms === "number" ? e.event_timestamp_ms : Date.now();

  // Idempotency: ignore an event older than what we've already applied (out-of-order / duplicate).
  const cur = await ctx.env.DB.prepare("SELECT updated_at FROM users WHERE uid = ?")
    .bind(uid)
    .first<{ updated_at: number }>();
  if (cur && cur.updated_at > eventTime) return json({ ok: true });

  // Downgrade: if the new cap is below the account's ACTIVE book count, require a trim.
  const newCap = limitFor(tier);
  const cntRow = await ctx.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM books WHERE uid = ? AND status = 'active'",
  )
    .bind(uid)
    .first<{ n: number }>();
  const needsTrim = (cntRow?.n ?? 0) > newCap;

  const cloud = isUnlimited(tier); // pro/premium clear the retention clock; free/standard start it
  const downgradedAt = cloud ? null : eventTime;

  await ctx.env.DB.prepare(
    `INSERT INTO users (uid, tier, updated_at, downgraded_at, trim_required, cap)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       tier = excluded.tier,
       updated_at = excluded.updated_at,
       downgraded_at = CASE WHEN ? THEN NULL ELSE COALESCE(users.downgraded_at, excluded.downgraded_at) END,
       trim_required = excluded.trim_required,
       cap = excluded.cap`,
  )
    .bind(uid, tier, eventTime, downgradedAt, needsTrim ? 1 : 0, newCap, cloud ? 1 : 0)
    .run();
  return json({ ok: true });
};
