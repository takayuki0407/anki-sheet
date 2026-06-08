-- Track when an account dropped from Pro to non-Pro — the start of the 6-month cloud-retention
-- clock. When a Pro user downgrades, their cloud data (R2 PDFs/content) is KEPT so re-upgrading
-- can restore it; the retention Worker purges it once this is older than 6 months. NULL means the
-- account is currently Pro (or never had cloud data to retain). Set/cleared by the RevenueCat
-- webhook; cleared again by the retention job after it purges.
ALTER TABLE users ADD COLUMN downgraded_at INTEGER;
