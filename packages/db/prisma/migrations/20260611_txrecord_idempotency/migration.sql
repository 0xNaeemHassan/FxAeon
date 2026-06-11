-- W-11: idempotency + explicit tx state machine support.
ALTER TABLE "TxRecord" ALTER COLUMN "hash" DROP NOT NULL;
ALTER TABLE "TxRecord" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "TxRecord" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "TxRecord_idempotencyKey_key" ON "TxRecord"("idempotencyKey");
CREATE INDEX "TxRecord_status_idx" ON "TxRecord"("status");
