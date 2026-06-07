// Pro PDF blob sync (R2). PUT uploads a book's PDF (the slot must already be reserved via
// POST /api/sync/books), GET downloads it. Pro-only; enforces 100MB/file and the 5GB account
// total. Returns 503 until R2 is enabled + bound (PDFS). egress from R2 is free, so downloads
// to other devices cost nothing.
import { json, type Fn } from "../../../../_lib/types";
import { getTier, MAX_FILE_BYTES, PRO_STORAGE_BYTES } from "../../../../_lib/tier";

const r2key = (uid: string, bookId: string) => `${uid}/${bookId}.pdf`;

export const onRequestPut: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  const bookId = ctx.params.bookId;
  if (!ctx.env.PDFS) return json({ error: "r2_not_configured" }, 503);
  if ((await getTier(ctx.env, uid)) !== "pro") return json({ error: "pro_required" }, 403);

  // The slot must already exist (POST /books reserves it + counts it against the cap).
  const reg = await ctx.env.DB.prepare("SELECT book_id FROM books WHERE uid = ? AND book_id = ?")
    .bind(uid, bookId)
    .first();
  if (!reg) return json({ error: "not_registered" }, 404);

  const len = Number(ctx.request.headers.get("content-length") ?? "0");
  if (len > MAX_FILE_BYTES) return json({ error: "file_too_large", max: MAX_FILE_BYTES }, 413);
  const sumRow = await ctx.env.DB.prepare(
    "SELECT COALESCE(SUM(size), 0) AS s FROM books WHERE uid = ? AND book_id <> ?",
  )
    .bind(uid, bookId)
    .first<{ s: number }>();
  const used = Number(sumRow?.s ?? 0);
  if (used + len > PRO_STORAGE_BYTES)
    return json({ error: "storage_full", used, limit: PRO_STORAGE_BYTES }, 413);

  const key = r2key(uid, bookId);
  const obj = await ctx.env.PDFS.put(key, ctx.request.body);
  const size = obj?.size ?? len;
  // Chunked uploads may have no Content-Length, so re-check against the real size.
  if (used + size > PRO_STORAGE_BYTES) {
    await ctx.env.PDFS.delete(key);
    return json({ error: "storage_full", used, limit: PRO_STORAGE_BYTES }, 413);
  }
  await ctx.env.DB.prepare(
    "UPDATE books SET size = ?, r2_key = ?, updated_at = ? WHERE uid = ? AND book_id = ?",
  )
    .bind(size, key, Date.now(), uid, bookId)
    .run();
  return json({ ok: true, size });
};

export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  if (!ctx.env.PDFS) return json({ error: "r2_not_configured" }, 503);
  const obj = await ctx.env.PDFS.get(r2key(uid, ctx.params.bookId));
  if (!obj) return json({ error: "not_found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": "application/pdf" } });
};
