-- Scope executor idempotency to the authenticated internal user. The old
-- global key let an unrelated user reserve another user's opaque nonce.
DROP INDEX IF EXISTS "TxRecord_idempotencyKey_key";

CREATE UNIQUE INDEX "TxRecord_userId_idempotencyKey_key"
ON "TxRecord"("userId", "idempotencyKey");
