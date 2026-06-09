// Account-wide book registry (Phase 1). GET lists the account's books + the cap state (count of
// ACTIVE books / cap / tier / trim_required). POST registers a new book, enforcing the tier cap
// ACROSS THE WHOLE ACCOUNT atomically (a conditional insert/revive so racing devices can't both take
// the last slot). Over the cap → 402. `status` distinguishes active / retained / trimmed books.
import { json, type Fn } from "../../_lib/types";
import { getTier, isUnlimited, limitFor } from "../../_lib/tier";

export const onRequestGet: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  const tier = await getTier(ctx.env, uid, ctx.data.email);
  const u = await ctx.env.DB.prepare("SELECT trim_required, cap FROM users WHERE uid = ?")
    .bind(uid)
    .first<{ trim_required: number; cap: number | null }>();
  const { results } = await ctx.env.DB.prepare(
    "SELECT book_id, name, size, page_count, device, status, updated_at, favorite, opened_at FROM books WHERE uid = ? ORDER BY updated_at DESC",
  )
    .bind(uid)
    .all<{ status?: string }>();
  const activeCount = results.filter((b) => (b.status ?? "active") === "active").length;
  return json({
    books: results,
    count: activeCount, // active books only — the cap-relevant count
    limit: limitFor(tier),
    tier,
    unlimited: isUnlimited(tier),
    trimRequired: !!u?.trim_required,
    cap: u?.cap ?? limitFor(tier),
  });
};

export const onRequestPost: Fn = async (ctx) => {
  const uid = ctx.data.uid!;
  let body: {
    book_id?: string;
    name?: string;
    size?: number;
    page_count?: number;
    device?: string;
  };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const bookId = typeof body.book_id === "string" ? body.book_id : "";
  if (!bookId) return json({ error: "book_id_required" }, 400);

  const now = Date.now();
  const name = String(body.name ?? "");
  const size = Number(body.size) || 0;
  const pageCount = Number(body.page_count) || 0;
  const device = typeof body.device === "string" ? body.device : null;

  const existing = await ctx.env.DB.prepare(
    "SELECT status FROM books WHERE uid = ? AND book_id = ?",
  )
    .bind(uid, bookId)
    .first<{ status: string }>();

  // Re-registering an ALREADY-active book → metadata update only (no new slot, no cap check).
  if (existing?.status === "active") {
    await ctx.env.DB.prepare(
      "UPDATE books SET name=?, size=?, page_count=?, device=?, updated_at=? WHERE uid=? AND book_id=?",
    )
      .bind(name, size, pageCount, device, now, uid, bookId)
      .run();
    return json({ ok: true });
  }

  // New book, OR reviving a trimmed/retained one → consumes a slot. Enforce the account-wide cap
  // atomically: the conditional insert/update only succeeds while the active count is under the cap.
  const tier = await getTier(ctx.env, uid, ctx.data.email);
  const cap = limitFor(tier);
  if (existing) {
    await ctx.env.DB.prepare(
      `UPDATE books SET name=?, size=?, page_count=?, device=?, status='active', updated_at=?
       WHERE uid=? AND book_id=? AND (SELECT COUNT(*) FROM books WHERE uid=? AND status='active') < ?`,
    )
      .bind(name, size, pageCount, device, now, uid, bookId, uid, cap)
      .run();
  } else {
    await ctx.env.DB.prepare(
      `INSERT INTO books (uid, book_id, name, size, page_count, device, status, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, 'active', ?
       WHERE (SELECT COUNT(*) FROM books WHERE uid = ? AND status = 'active') < ?`,
    )
      .bind(uid, bookId, name, size, pageCount, device, now, uid, cap)
      .run();
  }

  const final = await ctx.env.DB.prepare(
    "SELECT status FROM books WHERE uid = ? AND book_id = ?",
  )
    .bind(uid, bookId)
    .first<{ status: string }>();
  if (final?.status !== "active") {
    const c = await ctx.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM books WHERE uid = ? AND status = 'active'",
    )
      .bind(uid)
      .first<{ n: number }>();
    return json({ error: "limit_reached", count: c?.n ?? 0, limit: cap }, 402);
  }
  return json({ ok: true });
};
