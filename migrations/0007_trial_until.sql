-- 7-day trial AI budget (§1.4 / P1-1). trial_until = the trial's expiry (epoch ms; 0 = not in a
-- trial), set by the RevenueCat webhook from period_type=TRIAL + expiration_at_ms. While
-- now < trial_until the AI page budget is capped at TRIAL_GEN_PAGES regardless of the (trial) tier,
-- so a Premium trial can't hand out 200 pages.
ALTER TABLE users ADD COLUMN trial_until INTEGER NOT NULL DEFAULT 0;
