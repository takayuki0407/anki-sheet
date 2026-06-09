// Plan limits + the tier lookup, shared by the sync handlers. Account-wide caps (Phase 1 overhaul).
//   Free ¥0:        1 book,  AI 1 page/mo,   NO cloud sync.
//   Standard ¥300:  10 books, AI 10 page/mo, NO cloud sync.
//   Pro ¥600:       unlimited, AI 30 page/mo, cloud sync (5GB / 100MB-file).
//   Premium ¥980 (Phase 2): unlimited, AI 200 page/mo, cloud sync + adaptive SRS.
//   admin:          unlimited everything (the developer account, by verified email).
// Tier lives in users.tier, set by the RevenueCat webhook. A signed-in account with NO subscription
// is Free (NOT Standard) — Free is the floor, incl. the post-trial fallback.
import type { Env } from "./types";

export const FREE_DECK_LIMIT = 1;
export const STANDARD_DECK_LIMIT = 10;
export const PRO_STORAGE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB total (Pro+ cloud cap)
export const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
export const TRIAL_GEN_PAGES = 30; // AI budget during the 7-day trial (capped, separate from tier)

export type Tier = "free" | "standard" | "pro" | "premium" | "admin";

/** Pro / Premium / admin get unlimited books + cloud sync. Free / Standard are capped, no sync. */
export function isUnlimited(t: Tier): boolean {
  return t === "pro" || t === "premium" || t === "admin";
}
/** Whether the tier gets cloud sync (PDF/content/progress/questions). */
export function canSync(t: Tier): boolean {
  return isUnlimited(t);
}
/** Account-wide book cap. */
export function limitFor(t: Tier): number {
  if (isUnlimited(t)) return Number.MAX_SAFE_INTEGER;
  if (t === "standard") return STANDARD_DECK_LIMIT;
  return FREE_DECK_LIMIT; // free
}
/** Monthly AI question-generation page budget per tier. */
export function genPageLimit(t: Tier): number {
  switch (t) {
    case "admin":
      return Number.MAX_SAFE_INTEGER;
    case "premium":
      return 200;
    case "pro":
      return 30;
    case "standard":
      return 10;
    default:
      return 1; // free
  }
}

/** Monthly AI budget accounting for the 7-day trial (§1.4): while the trial is active the budget is
 * capped at TRIAL_GEN_PAGES regardless of the (trial) tier — so a Premium trial can't hand out 200
 * pages. `trialUntil` is the trial expiry (epoch ms; 0 = not in a trial). */
export function genLimitDuringTrial(t: Tier, trialUntil: number, now: number): number {
  const base = genPageLimit(t);
  return trialUntil > now ? Math.min(base, TRIAL_GEN_PAGES) : base;
}

/** Trial expiry (epoch ms) for an account, or 0 when not in a trial. Set by the RevenueCat webhook. */
export async function getTrialUntil(env: Env, uid: string): Promise<number> {
  const row = await env.DB.prepare("SELECT trial_until FROM users WHERE uid = ?")
    .bind(uid)
    .first<{ trial_until: number }>();
  return Number(row?.trial_until) || 0;
}

const TIERS = new Set<string>(["free", "standard", "pro", "premium", "admin"]);

export async function getTier(env: Env, uid: string, email?: string): Promise<Tier> {
  // An explicit tier row wins — including for the admin email, so the developer can switch their OWN
  // account to any tier to TEST plan behavior (see POST /api/sync/dev/tier). Set by the webhook.
  const row = await env.DB.prepare("SELECT tier FROM users WHERE uid = ?")
    .bind(uid)
    .first<{ tier: string }>();
  if (row?.tier && TIERS.has(row.tier)) return row.tier as Tier;
  // No explicit tier: the developer account (by verified email) is admin; everyone else is Free
  // (signed-in but no subscription = the free floor: 1 book, AI 1 page/mo).
  if (email && env.ADMIN_EMAIL && email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase())
    return "admin";
  return "free";
}
