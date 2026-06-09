// Cloud-data retention job (Cloudflare Worker, cron-triggered).
//
// Cloudflare PAGES Functions can't run on a schedule, so this is a SEPARATE Worker bound to the
// SAME D1 (anki-sheet-db) + R2 (anki-sheet-pdfs) as the Pages backend. Once a day it purges the
// PRESERVED cloud data of accounts that have been non-Pro for more than 6 months.
//
// Why preserve-then-purge: when a Pro subscriber downgrades to Standard (or lapses), their cloud
// PDFs/content are intentionally KEPT so re-upgrading to Pro restores everything. But we don't
// store that data for free forever — `users.downgraded_at` (set by the RevenueCat webhook) starts
// a 6-month clock; when it expires we delete the R2 objects under `${uid}/`, mark the books as
// cloud-cleared (size=0, r2_key=NULL), and clear downgraded_at so the account isn't re-scanned.
//
// Deploy:  wrangler deploy --config worker/wrangler.toml
// (idempotent + safe to run repeatedly; an account with no R2 objects is a no-op.)

interface D1Result<T> {
  results: T[];
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
interface D1DB {
  prepare(query: string): D1PreparedStatement;
}
interface R2Object {
  key: string;
}
interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}
interface R2Bucket {
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<R2Objects>;
}
interface Env {
  DB: D1DB;
  PDFS?: R2Bucket; // same bucket the Pages backend writes Pro PDFs/content to
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// ~6 months. We err toward keeping data a little LONGER (not deleting early): 183 days.
const RETENTION_MS = 183 * 24 * 60 * 60 * 1000;

export default {
  // Runs on the cron schedule in worker/wrangler.toml. waitUntil keeps the Worker alive until the
  // purge finishes (scheduled handlers have a generous time budget).
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(purgeExpired(env));
  },
};

/** Delete preserved cloud data for every account non-Pro for > RETENTION_MS. */
async function purgeExpired(env: Env): Promise<void> {
  const cutoff = Date.now() - RETENTION_MS;
  // Only purge accounts on a NON cloud-bearing tier. Excludes pro/premium/admin so an active paying
  // subscriber's data is never deleted even if a stale downgraded_at lingers (§4.3 safety).
  const { results } = await env.DB.prepare(
    "SELECT uid FROM users WHERE downgraded_at IS NOT NULL AND downgraded_at < ? AND tier NOT IN ('pro','premium','admin')",
  )
    .bind(cutoff)
    .all<{ uid: string }>();

  for (const { uid } of results) {
    // 1) Delete every R2 object under `${uid}/` — the preserved PDF blobs + content JSON. Paginate
    //    in case the account had many books.
    if (env.PDFS) {
      const prefix = `${uid}/`;
      let cursor: string | undefined;
      do {
        const listed = await env.PDFS.list({ prefix, cursor });
        if (listed.objects.length) await env.PDFS.delete(listed.objects.map((o) => o.key));
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
    }
    // 2) Mark the account's books as cloud-cleared: the slot rows remain (the account still "knows"
    //    about the books), but the file is gone, so the bookshelf won't offer a cloud download.
    await env.DB.prepare("UPDATE books SET size = 0, r2_key = NULL WHERE uid = ?").bind(uid).run();
    // 3) Purge the account's AI-generated questions too (the books are cloud-cleared and the account
    //    is non-Pro, so synced questions would just be orphaned rows). §4.3.
    await env.DB.prepare("DELETE FROM questions WHERE uid = ?").bind(uid).run();
    // 4) Stop the clock so we don't re-scan this account every day. A future Pro→downgrade cycle
    //    sets a fresh downgraded_at via the webhook.
    await env.DB.prepare("UPDATE users SET downgraded_at = NULL WHERE uid = ?").bind(uid).run();
  }
}
