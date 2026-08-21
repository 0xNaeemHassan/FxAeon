-- Persist fee-reconciliation attempts so a restart cannot reset retry limits.
ALTER TABLE "FeeLedger"
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
