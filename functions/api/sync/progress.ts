// Pull ALL progress for the account (reveal state / page position / red-sheet mode+band per
// book), e.g. on login to seed a new device. Pro-only (cross-platform progress sync is a Pro
// feature; Standard has no cloud sync).
import { json, type Fn } from "../../_lib/types";
import { getTier, isUnlimited } from "../../_lib/tier";

export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!isUnlimited(await getTier(ctx.env, uid, ctx.data.email)))
    return json({ error: "pro_required" }, 403);
  const { results } = await ctx.env.DB.prepare(
    "SELECT book_id, data, updated_at FROM progress WHERE uid = ?",
  )
    .bind(uid)
    .all();
  return json({ progress: results });
};
