// Pro deck "content" sync (R2 JSON): everything needed to reconstruct a deck on another device
// WITHOUT re-detecting — name, color config, page geometry, detected answers (clozes), bookmarks.
// The PDF itself is the sibling .pdf blob. PUT is Pro-only; GET is open to the owner (so a
// downgraded user can still retrieve their data). Returns 503 until R2 is bound.
import { json, type Fn } from "../../../../_lib/types";
import { getTier, isUnlimited } from "../../../../_lib/tier";

const key = (uid: string, bookId: string) => `${uid}/${bookId}.json`;

export const onRequestPut: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!ctx.env.PDFS) return json({ error: "r2_not_configured" }, 503);
  if (!isUnlimited(await getTier(ctx.env, uid, ctx.data.email)))
    return json({ error: "pro_required" }, 403);
  const bodyText = await ctx.request.text(); // opaque JSON string
  await ctx.env.PDFS.put(key(uid, ctx.params.bookId), bodyText);
  return json({ ok: true });
};

export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!ctx.env.PDFS) return json({ error: "r2_not_configured" }, 503);
  const obj = await ctx.env.PDFS.get(key(uid, ctx.params.bookId));
  if (!obj) return json({ error: "not_found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": "application/json" } });
};
