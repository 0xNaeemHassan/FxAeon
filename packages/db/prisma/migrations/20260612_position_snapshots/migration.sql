-- Position entry snapshots: first-seen state of an on-chain position, the
-- honest basis for PnL estimates (no fabricated entry prices).
CREATE TABLE "PositionSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "positionId" INTEGER NOT NULL,
    "entryCollateral" DOUBLE PRECISION NOT NULL,
    "entryDebt" DOUBLE PRECISION NOT NULL,
    "entrySpotUsd" DOUBLE PRECISION,
    "entryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PositionSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PositionSnapshot_userId_market_side_positionId_key"
    ON "PositionSnapshot"("userId", "market", "side", "positionId");
CREATE INDEX "PositionSnapshot_userId_idx" ON "PositionSnapshot"("userId");

ALTER TABLE "PositionSnapshot" ADD CONSTRAINT "PositionSnapshot_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rollback:
--   DROP TABLE "PositionSnapshot";
