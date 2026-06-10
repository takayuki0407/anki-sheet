-- 4択 (multiple-choice) questions + SM-2 review state (機能拡張: 4択とSRS).

-- A-1. Question type + choices. Existing rows stay 'tf' (○×) — backward compatible.
-- Regeneration REPLACE is now scoped to (uid, book_id, page_index, qtype), so regenerating
-- ○× never deletes the page's 4択 set (and vice versa).
ALTER TABLE questions ADD COLUMN qtype TEXT NOT NULL DEFAULT 'tf'; -- 'tf' | 'mc4'
ALTER TABLE questions ADD COLUMN choices TEXT;                     -- mc4 only: JSON array of 4 strings
CREATE INDEX IF NOT EXISTS idx_q_book_page_type ON questions(uid, book_id, page_index, qtype);

-- Paid-generation markers: one row per (account, book, page, type) that has EVER consumed a
-- quota slot. A regeneration of a marked unit is FREE (the slot was paid once); only the first
-- generation of a unit reserves quota. Works for ALL tiers (Standard's questions stay local-only,
-- but the marker lives here so its regenerations are free too). Backfilled from existing rows.
CREATE TABLE IF NOT EXISTS generated_units (
  uid        TEXT    NOT NULL,
  book_id    TEXT    NOT NULL,
  page_index INTEGER NOT NULL,
  qtype      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (uid, book_id, page_index, qtype)
);
INSERT OR IGNORE INTO generated_units (uid, book_id, page_index, qtype, created_at)
  SELECT uid, book_id, page_index, qtype, MIN(created_at) FROM questions
  GROUP BY uid, book_id, page_index, qtype;

-- A-2. SM-2 review state, one row per (account, question). Premium-only WRITES (SRS sync);
-- Free/Standard/Pro keep their answer history local-only (間違いのみ復習 works on-device).
-- Synced per-key LWW: an upsert only applies when the incoming updated_at is newer.
CREATE TABLE IF NOT EXISTS reviews (
  uid         TEXT NOT NULL,
  question_id TEXT NOT NULL,
  ease        REAL NOT NULL DEFAULT 2.5,
  interval_d  INTEGER NOT NULL DEFAULT 0,
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  due_at      INTEGER NOT NULL,           -- next due (epoch ms)
  last_at     INTEGER NOT NULL,           -- last answered (epoch ms)
  last_ok     INTEGER NOT NULL,           -- 0/1 (also drives 間違いのみ復習)
  updated_at  INTEGER NOT NULL,           -- LWW clock
  PRIMARY KEY (uid, question_id)
);
CREATE INDEX IF NOT EXISTS idx_r_due ON reviews(uid, due_at);
