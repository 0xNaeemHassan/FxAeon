-- W-16: store the Privy wallet API id of the policy-guarded wallet so the
-- tx executor can sign without re-resolving the wallet through Privy.
-- Additive only (PLAN.md no-touch list).
ALTER TABLE "User" ADD COLUMN "privyWalletId" TEXT;
CREATE UNIQUE INDEX "User_privyWalletId_key" ON "User"("privyWalletId");

-- Rollback:
--   DROP INDEX "User_privyWalletId_key";
--   ALTER TABLE "User" DROP COLUMN "privyWalletId";
