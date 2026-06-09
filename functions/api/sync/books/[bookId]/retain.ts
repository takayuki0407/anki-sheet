// Non-destructive "release from the cap" action: flip an owner's ACTIVE book (with a cloud copy,
// size>0) to status='retained'. The R2 objects are KEPT (so re-Pro restore brings it back via
// reactivateRetained), but the slot stops counting toward the account cap — so a Standard/Free user
// who locally deletes a cloud-backed book actually frees a slot, instead of leaving a stuck
// "cloud-only active" row. size=0 books (no cloud copy) are NOT retained here — they have nowhere to
// preserve, so their delete path stays the permanent unregister. (Auth uid injected by the sync
// middleware.) Idempotent: a no-match (already retained / size=0 / not found) is a harmless no-op.
import { json, type Fn } from "../../../../_lib/types";

export const onRequestPost: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  await ctx.env.DB.prepare(
    "UPDATE books SET status = 'retained', device = NULL, updated_at = ? WHERE uid = ? AND book_id = ? AND status = 'active' AND size > 0",
  )
    .bind(Date.now(), uid, ctx.params.bookId)
    .run();
  return json({ ok: true });
};
