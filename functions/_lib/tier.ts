// Plan limits + the tier lookup, shared by the sync handlers.
//   Standard ¥300/mo: 10 books (account-global), NO cloud sync.
//   Pro ¥600/mo:      unlimited books, cloud sync up to 5GB, 100MB/file.
// Tier lives in users.tier, kept fresh by the RevenueCat webhook (TODO). Until that's wired,
// getTier returns 'standard' for everyone — so Pro-gated routes (blob/progress) 403 until a
// user's tier is set (manually in D1 for testing, or by the webhook in production).
import type { Env } from "./types";

export const STANDARD_DECK_LIMIT = 10;
export const PRO_STORAGE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB total (Pro cloud cap)
export const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file

export type Tier = "standard" | "pro" | "admin";

/** 'admin' (the developer account, by email) and 'pro' are unlimited; 'standard' is capped. */
export function isUnlimited(t: Tier): boolean {
  return t === "pro" || t === "admin";
}
export function limitFor(t: Tier): number {
  return isUnlimited(t) ? Number.MAX_SAFE_INTEGER : STANDARD_DECK_LIMIT;
}

export async function getTier(env: Env, uid: string, email?: string): Promise<Tier> {
  // An EXPLICIT tier row wins — including for the admin email. This lets the developer switch their
  // OWN account to standard/pro to TEST plan behavior (forced-trim downgrade, the Standard limit,
  // Pro cloud sync, retention) via the admin-only POST /api/sync/dev/tier, without a live
  // subscription. In production the row is set by the RevenueCat webhook.
  const row = await env.DB.prepare("SELECT tier FROM users WHERE uid = ?")
    .bind(uid)
    .first<{ tier: string }>();
  if (row?.tier === "standard" || row?.tier === "pro" || row?.tier === "admin") return row.tier;
  // No explicit tier: the developer account (by verified email) is unlimited; everyone else is
  // Standard (the safe, most-restrictive paid fallback until the webhook reports).
  if (email && env.ADMIN_EMAIL && email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase())
    return "admin";
  return "standard";
}
