// Delete ALL of the account's cloud data. Called by the client right before it removes the
// Firebase auth user, so deleting an account also erases everything stored in the cloud:
//   - R2: every object under the user's `${uid}/` prefix (PDF blobs + deck content JSON)
//   - D1: the account's rows in progress / books / users (tier)
// Authenticated (uid comes from the verified token via the sync middleware); a user can only ever
// delete their own data. Idempotent — safe to retry.
import { json, type Fn } from "../../_lib/types";

export const onRequestDelete: Fn = async (ctx) => {
  const uid = ctx.data.uid!;

  // 1) R2 blobs: list + batch-delete everything under `${uid}/` (paginate in case of many books).
  if (ctx.env.PDFS) {
    const prefix = `${uid}/`;
    let cursor: string | undefined;
    do {
      const listed = await ctx.env.PDFS.list({ prefix, cursor });
      if (listed.objects.length) await ctx.env.PDFS.delete(listed.objects.map((o) => o.key));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  // 2) D1 rows for this account.
  await ctx.env.DB.prepare("DELETE FROM progress WHERE uid = ?").bind(uid).run();
  await ctx.env.DB.prepare("DELETE FROM books WHERE uid = ?").bind(uid).run();
  await ctx.env.DB.prepare("DELETE FROM users WHERE uid = ?").bind(uid).run();

  return json({ ok: true });
};
