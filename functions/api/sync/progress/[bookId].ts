// Push/read one book's progress. The blob carries a position group (page/mode/redMode/band/revealed)
// AND two element-sets — ★ stars + しおり bookmarks — as LWW maps (改修案 §4.2). PUT MERGES the
// incoming blob into the stored one per-key (adds/deletes both converge), so a stale push can't wipe
// another device's edits. Position group is whole-blob LWW gated by `posAt`. Pro-only.
import { json, type Fn } from "../../../_lib/types";
import { getTier, isUnlimited } from "../../../_lib/tier";
import {
  normalize,
  mergeBlobs,
  activeStarKeys,
  activeBookmarks,
  type ProgressBlob,
} from "../../../_lib/progressMerge";

export const onRequestPut: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!isUnlimited(await getTier(ctx.env, uid, ctx.data.email)))
    return json({ error: "pro_required" }, 403);
  let body: { data?: unknown };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const now = Date.now();
  const incoming = (body?.data ?? {}) as ProgressBlob;
  // A push without posAt (legacy client) is treated as "position set now" so it still resolves.
  const inc = normalize({ ...incoming, posAt: incoming.posAt ?? now }, now);

  const row = await ctx.env.DB.prepare(
    "SELECT data, updated_at FROM progress WHERE uid = ? AND book_id = ?",
  )
    .bind(uid, ctx.params.bookId)
    .first<{ data: string; updated_at: number }>();

  let merged: ProgressBlob = inc;
  if (row) {
    const storedAt = Number(row.updated_at) || 1;
    let stored: ProgressBlob = {};
    try {
      stored = JSON.parse(row.data) as ProgressBlob;
    } catch {
      /* corrupt row → treat as empty */
    }
    merged = mergeBlobs(normalize(stored, storedAt), inc);
  }

  const data = JSON.stringify(merged);
  await ctx.env.DB.prepare(
    `INSERT INTO progress (uid, book_id, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(uid, book_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(uid, ctx.params.bookId, data, now)
    .run();
  return json({ ok: true });
};

export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!isUnlimited(await getTier(ctx.env, uid, ctx.data.email)))
    return json({ error: "pro_required" }, 403);
  const row = await ctx.env.DB.prepare(
    "SELECT data, updated_at FROM progress WHERE uid = ? AND book_id = ?",
  )
    .bind(uid, ctx.params.bookId)
    .first<{ data: string; updated_at: number }>();
  if (!row) return json({ error: "not_found" }, 404);
  // Compat shim: the stored blob is maps-only, but PRE-§4.2 clients read starredKeys/bookmarks. Emit
  // the derived live arrays alongside the maps so old apps keep working. New clients ignore them
  // (normalize skips legacy folding once a map is present), so this can't resurrect a tombstone.
  let out = row.data;
  try {
    const blob = JSON.parse(row.data) as ProgressBlob;
    if (blob.starsLww || blob.bmLww)
      out = JSON.stringify({
        ...blob,
        starredKeys: activeStarKeys(blob),
        bookmarks: activeBookmarks(blob),
      });
  } catch {
    /* corrupt row → return as-is */
  }
  return json({ data: out, updated_at: row.updated_at });
};
