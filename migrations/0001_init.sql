-- anki-sheet sync backend — initial schema (D1 / SQLite).

-- Subscription tier per account, kept fresh by the RevenueCat webhook (TODO). Default
-- 'standard' is the safe (most-restrictive paid) fallback until the webhook reports.
CREATE TABLE IF NOT EXISTS users (
  uid        TEXT PRIMARY KEY,
  tier       TEXT NOT NULL DEFAULT 'standard',  -- 'standard' | 'pro'
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- Account-global book registry. One row per book the account holds (on ANY device), so the
-- Standard 10-cap is enforced across all devices. For Standard the file is NOT uploaded
-- (size 0, r2_key NULL) — only the slot is reserved. Pro fills size/r2_key when the PDF syncs.
CREATE TABLE IF NOT EXISTS books (
  uid         TEXT NOT NULL,
  book_id     TEXT NOT NULL,             -- client-generated stable id (uuid)
  name        TEXT NOT NULL DEFAULT '',
  size        INTEGER NOT NULL DEFAULT 0, -- bytes of the synced PDF (for the Pro 5GB cap)
  r2_key      TEXT,                       -- R2 object key once the blob is synced (Pro)
  page_count  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,           -- ms epoch
  PRIMARY KEY (uid, book_id)
);
CREATE INDEX IF NOT EXISTS idx_books_uid ON books(uid);

-- Cross-platform progress (reveal state, page position, red-sheet mode/band) per book.
CREATE TABLE IF NOT EXISTS progress (
  uid        TEXT NOT NULL,
  book_id    TEXT NOT NULL,
  data       TEXT NOT NULL,               -- JSON blob (opaque to the server)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (uid, book_id)
);
