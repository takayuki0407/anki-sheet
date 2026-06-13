// RevenueCat webhook → keep users.tier in sync with the subscription (admin stays unlimited by email
// regardless). RC POSTs subscription events with an Authorization header equal to RC_WEBHOOK_SECRET.
// `app_user_id` is the Firebase uid (Purchases.logIn). Maps events to free/standard/pro/premium,
// uses the EVENT timestamp (idempotent against out-of-order/duplicate delivery), and sets a downgrade
// trim flag when the new cap is below the account's active book count. TRANSFER (the store
// subscription moved to a different app account — e.g. the same Apple ID restored under a new
// login) carries no entitlement_ids, so the tier we last recorded for the old owner moves over.
import { json, type Fn } from "../../_lib/types";
import { isUnlimited, limitFor, reactivateRetained, type Tier } from "../../_lib/tier";

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

const RANK: Record<string, number> = { free: 0, standard: 1, pro: 2, premium: 3 };
const isAnon = (id: string) => id.startsWith("$RCAnonymousID:");

type Ctx = Parameters<Fn>[0];

/** Write one uid's tier (idempotent on event time) with the cap/trim/retention-clock/trial
 * bookkeeping shared by the subscription events and TRANSFER. */
async function applyTier(
  ctx: Ctx,
  uid: string,
  tier: Tier,
  eventTime: number,
  trialUntil: number,
): Promise<void> {
  // Idempotency: ignore an event older than what we've already applied (out-of-order / duplicate).
  // An 'admin' row is the developer's dev state (set via /api/sync/dev/tier), never
  // subscription-driven — no store event may overwrite it (including as a TRANSFER target).
  const cur = await ctx.env.DB.prepare("SELECT tier, updated_at FROM users WHERE uid = ?")
    .bind(uid)
    .first<{ tier: string; updated_at: number }>();
  if (cur && cur.updated_at > eventTime) return;
  if (cur?.tier === "admin") return;

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
    `INSERT INTO users (uid, tier, updated_at, downgraded_at, trim_required, cap, trial_until)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       tier = excluded.tier,
       updated_at = excluded.updated_at,
       downgraded_at = CASE WHEN ? THEN NULL ELSE COALESCE(users.downgraded_at, excluded.downgraded_at) END,
       trim_required = excluded.trim_required,
       cap = excluded.cap,
       trial_until = excluded.trial_until`,
  )
    .bind(uid, tier, eventTime, downgradedAt, needsTrim ? 1 : 0, newCap, trialUntil, cloud ? 1 : 0)
    .run();
  // Re-Pro restore: returning to a cloud-bearing tier reactivates books preserved on a prior
  // downgrade (status='retained' → 'active'), so they reappear in the bookshelf's cloud section.
  if (cloud) await reactivateRetained(ctx.env, uid);
}

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
      period_type?: string; // "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL"
      expiration_at_ms?: number;
      transferred_from?: string[];
      transferred_to?: string[];
    };
  };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const e = body.event;
  if (!e?.type) return json({ ok: true });
  const eventTime = typeof e.event_timestamp_ms === "number" ? e.event_timestamp_ms : Date.now();

  // TRANSFER: the store subscription now belongs to transferred_to. Move the tier we last recorded
  // for the old owner(s) to the new owner and drop the old owner(s) to the Free floor. Anonymous RC
  // ids never match a Firebase uid → skip; an 'admin' row is email-derived dev state, not a
  // subscription → never moved or overwritten.
  if (e.type === "TRANSFER") {
    const from = (e.transferred_from ?? []).filter((id) => !isAnon(id));
    const to = (e.transferred_to ?? []).filter((id) => !isAnon(id));
    const rows: { uid: string; tier: string; trialUntil: number }[] = [];
    for (const uid of from) {
      const row = await ctx.env.DB.prepare("SELECT tier, trial_until FROM users WHERE uid = ?")
        .bind(uid)
        .first<{ tier: string; trial_until: number | null }>();
      if (row) rows.push({ uid, tier: row.tier, trialUntil: row.trial_until ?? 0 });
    }
    let moved: Tier = "free";
    let movedTrial = 0;
    for (const r of rows) {
      if (RANK[r.tier] !== undefined && RANK[r.tier] > RANK[moved]) {
        moved = r.tier as Tier;
        movedTrial = r.trialUntil;
      }
    }
    if (to[0] && moved !== "free") await applyTier(ctx, to[0], moved, eventTime, movedTrial);
    for (const r of rows) {
      if (r.tier !== "admin") await applyTier(ctx, r.uid, "free", eventTime, 0);
    }
    return json({ ok: true });
  }

  if (!e.app_user_id) return json({ ok: true });

  let tier: Tier | null = null;
  if (GRANT.has(e.type)) {
    const ents = e.entitlement_ids ?? [];
    // An empty / unknown entitlement set must NOT silently grant the paid "standard" tier — fall
    // through to null so a GRANT carrying no recognizable entitlement is a no-op (handled below).
    tier = ents.includes("premium")
      ? "premium"
      : ents.includes("pro")
        ? "pro"
        : ents.includes("standard")
          ? "standard"
          : null;
  } else if (REVOKE.has(e.type)) {
    tier = "free"; // expired subscription → the Free floor (NOT Standard)
  }
  if (tier === null) return json({ ok: true }); // e.g. CANCELLATION — keep current access

  // 7-day trial (§1.4): while in a TRIAL period the AI budget is capped (genLimitDuringTrial reads
  // this). trial_until = the trial's expiry; cleared (0) once the subscription is NORMAL or expired.
  const inTrial = e.period_type === "TRIAL";
  const trialUntil = inTrial
    ? typeof e.expiration_at_ms === "number"
      ? e.expiration_at_ms
      : eventTime
    : 0;

  await applyTier(ctx, e.app_user_id, tier, eventTime, trialUntil);
  return json({ ok: true });
};
