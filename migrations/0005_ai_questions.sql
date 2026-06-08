-- AI true/false (○×) question generation (phase 1).

-- Monthly per-account generation quota (the "page budget"). A new YYYY-MM resets the count.
-- Counts ALL tiers (Standard/Pro/admin); admin is treated as unlimited in code.
CREATE TABLE IF NOT EXISTS generation_usage (
  uid    TEXT NOT NULL,
  period TEXT NOT NULL,             -- 'YYYY-MM' (UTC)
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, period)
);

-- Generated question bank. Stored server-side only for Pro+ (the synced tiers); Standard keeps its
-- questions LOCAL only (this table never holds Standard rows). One book = one quiz set; each page
-- holds at most 6 questions. Regeneration REPLACES a page's rows (delete + insert in one batch), so
-- a book never exceeds pageCount × 6 rows.
CREATE TABLE IF NOT EXISTS questions (
  id          TEXT PRIMARY KEY,     -- uuid
  uid         TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  page_index  INTEGER NOT NULL,
  statement   TEXT NOT NULL,
  answer      TEXT NOT NULL,        -- '正' | '誤'
  explanation TEXT,
  source      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_q_book_page ON questions(uid, book_id, page_index);
