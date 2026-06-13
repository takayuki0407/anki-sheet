// Pro deck "content" sync (R2 JSON): everything needed to reconstruct a deck on another device
// WITHOUT re-detecting — name, color config, page geometry, detected answers (clozes), bookmarks.
// The PDF itself is the sibling .pdf blob. PUT is Pro-only; GET is open to the owner (so a
// downgraded user can still retrieve their data). Returns 503 until R2 is bound.
//
// Masks (clozes) are an LWW-element-set (P0-2): a PUT carrying `clozesLww` is MERGED per-key into the
// stored content (so concurrent mask edits on two devices don't clobber each other). A legacy PUT
// (only `clozes[]`, from an old client) keeps the old whole-blob replace. GET returns the merged blob
// plus the active `clozes[]` mirror so old clients keep working.
import { json, type Fn } from "../../../../_lib/types";
import { canFetchOwnBook, getTier, isUnlimited } from "../../../../_lib/tier";
import {
  normalizeContent,
  mergeContent,
  activeClozes,
  type ContentBlob,
} from "../../../../_lib/contentMerge";

const key = (uid: string, bookId: string) => `${uid}/${bookId}.json`;

export const onRequestPut: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!ctx.env.PDFS) return json({ error: "r2_not_configured" }, 503);
  if (!isUnlimited(await getTier(ctx.env, uid, ctx.data.email)))
    return json({ error: "pro_required" }, 403);
  const bodyText = await ctx.request.text();
  let incoming: ContentBlob;
  try {
    incoming = JSON.parse(bodyText) as ContentBlob;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  // Legacy client (no element-set): keep the old whole-blob replace so its add/remove still works.
  if (!incoming.clozesLww) {
    await ctx.env.PDFS.put(key(uid, ctx.params.bookId), bodyText);
    return json({ ok: true });
  }
  // New client: MERGE the incoming element-set into the stored content (per-key LWW; meta by contentAt).
  const now = Date.now();
  const inc = normalizeContent({ ...incoming, contentAt: incoming.contentAt ?? now }, now);
  const existing = await ctx.env.PDFS.get(key(uid, ctx.params.bookId));
  let merged: ContentBlob = inc;
  if (existing) {
    let stored: ContentBlob = {};
    try {
      stored = JSON.parse(await existing.text()) as ContentBlob;
    } catch {
      /* corrupt object → treat as empty */
    }
    merged = mergeContent(normalizeContent(stored, stored.contentAt ?? 1), inc);
  }
  await ctx.env.PDFS.put(key(uid, ctx.params.bookId), JSON.stringify(merged));
  return json({ ok: true });
};

export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!ctx.env.PDFS) return json({ error: "r2_not_configured" }, 503);
  // Mirror blob.ts: the owner may fetch their own ACTIVE book on any tier, but retained/trimmed
  // content stays Pro-only (preserved purely for re-Pro restore) — same gate as the PDF blob GET.
  const row = await ctx.env.DB.prepare("SELECT status FROM books WHERE uid = ? AND book_id = ?")
    .bind(uid, ctx.params.bookId)
    .first<{ status: string }>();
  if (!canFetchOwnBook(row?.status, await getTier(ctx.env, uid, ctx.data.email)))
    return json({ error: "pro_required" }, 403);
  const obj = await ctx.env.PDFS.get(key(uid, ctx.params.bookId));
  if (!obj) return json({ error: "not_found" }, 404);
  const text = await obj.text();
  // Compat: emit the active clozes[] mirror so PRE-P0-2 clients (which read content.clozes) keep
  // working. New clients read clozesLww (normalizeContent ignores the mirror when a map is present).
  let out = text;
  try {
    const blob = JSON.parse(text) as ContentBlob;
    if (blob.clozesLww)
      out = JSON.stringify({
        ...blob,
        clozes: activeClozes(blob).map((e) => ({
          pageIndex: e.pageIndex,
          rects: e.rects,
          bbox: e.bbox,
          text: e.text,
        })),
      });
  } catch {
    /* not JSON or corrupt → return as-is */
  }
  return new Response(out, { headers: { "Content-Type": "application/json" } });
};
