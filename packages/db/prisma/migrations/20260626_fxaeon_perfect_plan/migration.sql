-- FxAeon Master Plan: single additive migration.
-- Mechanical rollback: see bottom of file.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. New columns on User
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "User" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'beginner';
ALTER TABLE "User" ADD COLUMN "defaultCollateralToken" TEXT NOT NULL DEFAULT 'fxUSD';
ALTER TABLE "User" ADD COLUMN "defaultLeverage" DOUBLE PRECISION NOT NULL DEFAULT 3.0;
ALTER TABLE "User" ADD COLUMN "displayCurrency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "User" ADD COLUMN "riskWarnings" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "positionView" TEXT NOT NULL DEFAULT 'compact';
ALTER TABLE "User" ADD COLUMN "oracleDivergenceBps" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "User" ADD COLUMN "chainlinkStalenessSec" INTEGER NOT NULL DEFAULT 3600;
ALTER TABLE "User" ADD COLUMN "lastWithdrawTargets" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deletePending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "referrerVolumeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "firstTradeAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "maxDailyVolumeUsd" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "maxOpenPositions" INTEGER;
ALTER TABLE "User" ADD COLUMN "coolDownAfterLiquidationSec" INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. New columns on PositionSnapshot
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "PositionSnapshot" ADD COLUMN "realizedPnlUsd" DOUBLE PRECISION;
ALTER TABLE "PositionSnapshot" ADD COLUMN "closingFeesUsd" DOUBLE PRECISION;
ALTER TABLE "PositionSnapshot" ADD COLUMN "closingTxHash" TEXT;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. New column on Referral
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "Referral" ADD COLUMN "paidUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. New columns on NotificationPref
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "NotificationPref" ADD COLUMN "funding" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NotificationPref" ADD COLUMN "apy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NotificationPref" ADD COLUMN "portfolio" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NotificationPref" ADD COLUMN "fxsaveRedeemable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NotificationPref" ADD COLUMN "lastFundingAlert" TIMESTAMP(3);
ALTER TABLE "NotificationPref" ADD COLUMN "lastApyAlert" TIMESTAMP(3);
ALTER TABLE "NotificationPref" ADD COLUMN "lastPortfolioAlert" TIMESTAMP(3);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. New column on PriceAlert (optional auto-expiry for fxsave_redeemable)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "PriceAlert" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. New table: FeeLedger
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE "FeeLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referrerCode" TEXT,
    "txHash" TEXT,
    "intentKind" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "tokenAmountWei" TEXT NOT NULL,
    "usdAmount" DOUBLE PRECISION NOT NULL,
    "notionalUsd" DOUBLE PRECISION NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "feeOrphan" BOOLEAN NOT NULL DEFAULT false,
    "payoutCycle" TEXT NOT NULL,
    "referrerShare" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "referrerPaidAt" TIMESTAMP(3),
    "referrerTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeeLedger_userId_idx" ON "FeeLedger"("userId");
CREATE INDEX "FeeLedger_referrerCode_payoutCycle_idx" ON "FeeLedger"("referrerCode", "payoutCycle");
CREATE INDEX "FeeLedger_payoutCycle_referrerPaidAt_idx" ON "FeeLedger"("payoutCycle", "referrerPaidAt");
CREATE INDEX "FeeLedger_txHash_idx" ON "FeeLedger"("txHash");
CREATE INDEX "FeeLedger_intentKind_feeOrphan_createdAt_idx" ON "FeeLedger"("intentKind", "feeOrphan", "createdAt");

ALTER TABLE "FeeLedger" ADD CONSTRAINT "FeeLedger_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. New table: BotState
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE "BotState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotState_pkey" PRIMARY KEY ("key")
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. New table: DepositWatcher
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE "DepositWatcher" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromBlock" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositWatcher_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DepositWatcher_userId_idx" ON "DepositWatcher"("userId");
CREATE INDEX "DepositWatcher_expiresAt_idx" ON "DepositWatcher"("expiresAt");

ALTER TABLE "DepositWatcher" ADD CONSTRAINT "DepositWatcher_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback (mechanical, paste into a down migration if needed):
-- ═══════════════════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS "DepositWatcher";
-- DROP TABLE IF EXISTS "BotState";
-- DROP TABLE IF EXISTS "FeeLedger";
-- ALTER TABLE "PriceAlert" DROP COLUMN IF EXISTS "expiresAt";
-- ALTER TABLE "NotificationPref" DROP COLUMN IF EXISTS "funding", DROP COLUMN IF EXISTS "apy",
--   DROP COLUMN IF EXISTS "portfolio", DROP COLUMN IF EXISTS "fxsaveRedeemable",
--   DROP COLUMN IF EXISTS "lastFundingAlert", DROP COLUMN IF EXISTS "lastApyAlert",
--   DROP COLUMN IF EXISTS "lastPortfolioAlert";
-- ALTER TABLE "Referral" DROP COLUMN IF EXISTS "paidUsd";
-- ALTER TABLE "PositionSnapshot" DROP COLUMN IF EXISTS "realizedPnlUsd",
--   DROP COLUMN IF EXISTS "closingFeesUsd", DROP COLUMN IF EXISTS "closingTxHash";
-- ALTER TABLE "User" DROP COLUMN IF EXISTS "mode", DROP COLUMN IF EXISTS "defaultCollateralToken",
--   DROP COLUMN IF EXISTS "defaultLeverage", DROP COLUMN IF EXISTS "displayCurrency",
--   DROP COLUMN IF EXISTS "riskWarnings", DROP COLUMN IF EXISTS "positionView",
--   DROP COLUMN IF EXISTS "oracleDivergenceBps", DROP COLUMN IF EXISTS "chainlinkStalenessSec",
--   DROP COLUMN IF EXISTS "lastWithdrawTargets", DROP COLUMN IF EXISTS "deletedAt",
--   DROP COLUMN IF EXISTS "deletePending", DROP COLUMN IF EXISTS "referrerVolumeUsd",
--   DROP COLUMN IF EXISTS "firstTradeAt", DROP COLUMN IF EXISTS "maxDailyVolumeUsd",
--   DROP COLUMN IF EXISTS "maxOpenPositions", DROP COLUMN IF EXISTS "coolDownAfterLiquidationSec";
