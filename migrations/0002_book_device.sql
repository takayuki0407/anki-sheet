-- Track which device imported each book, shown in the over-limit chooser so the user can tell
-- their books apart across devices.
ALTER TABLE books ADD COLUMN device TEXT;
