-- Per-book user state that syncs across the account's devices: a favorite flag (pinned to the top
-- of the bookshelf) and the last-opened time (drives the 最近開いた順 sort). Both default to 0 so
-- existing rows and Standard (count-only) registrations keep working unchanged.
ALTER TABLE books ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE books ADD COLUMN opened_at INTEGER NOT NULL DEFAULT 0;
