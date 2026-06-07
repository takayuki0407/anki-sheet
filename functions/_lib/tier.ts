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

export type Tier = "standard" | "pro";

export async function getTier(env: Env, uid: string): Promise<Tier> {
  const row = await env.DB.prepare("SELECT tier FROM users WHERE uid = ?")
    .bind(uid)
    .first<{ tier: string }>();
  return row?.tier === "pro" ? "pro" : "standard";
}
