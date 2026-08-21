-- Persist the deposit watcher's per-wallet scan cursor and native-ETH
-- baseline. Both columns are deliberately nullable: existing active watchers
-- cannot be assigned an honest ETH baseline by SQL, and rows created by the
-- old implementation may contain fromBlock=0. The worker safely bootstraps
-- those rows from the live chain before it begins detecting new deposits.
ALTER TABLE "DepositWatcher"
  ADD COLUMN "lastCheckedBlock" BIGINT,
  ADD COLUMN "ethBalanceBaselineWei" BIGINT;

-- Rows with a real activation block can safely begin their first post-upgrade
-- log scan there. Leave legacy fromBlock=0 rows NULL so the worker establishes
-- their activation point at the current chain head instead of scanning from
-- genesis.
UPDATE "DepositWatcher"
SET "lastCheckedBlock" = "fromBlock" - 1
WHERE "fromBlock" > 0;
