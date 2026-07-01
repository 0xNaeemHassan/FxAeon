-- Phase 3: Fee Layer — additive schema changes.

-- Add exit snapshot fields to PositionSnapshot for realized PnL.
ALTER TABLE "PositionSnapshot" ADD COLUMN IF NOT EXISTS "exitCollateral" DOUBLE PRECISION;
ALTER TABLE "PositionSnapshot" ADD COLUMN IF NOT EXISTS "exitDebt" DOUBLE PRECISION;
ALTER TABLE "PositionSnapshot" ADD COLUMN IF NOT EXISTS "exitSpotUsd" DOUBLE PRECISION;
