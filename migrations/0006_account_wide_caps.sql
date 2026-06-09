-- Phase 1 (Kiokumate plan overhaul): account-wide book caps + downgrade trim.

-- trim_required: set by the RevenueCat webhook when a downgrade leaves the account over its new cap;
-- cleared by POST /api/sync/trim. While set, the client forces the trim screen and blocks imports.
-- cap: the kept-set target after a downgrade (tier-derived but persisted so the trim UI is stable).
ALTER TABLE users ADD COLUMN trim_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN cap INTEGER;

-- books.status:
--   active   — counts toward the account cap; usable.
--   retained — trimmed off but its R2 copy is KEPT (re-Pro can restore it).
--   trimmed  — trimmed off, no cloud copy (local-only book that was let go).
--   pending  — imported locally but not yet cap-approved by the server (offline import); not usable
--              until the server confirms a slot.
ALTER TABLE books ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
