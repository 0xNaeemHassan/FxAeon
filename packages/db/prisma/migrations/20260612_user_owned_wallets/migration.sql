-- User-owned Privy wallets: track the user's session-signer grant (bot
-- trading delegation) and whether the wallet key was imported.
ALTER TABLE "User" ADD COLUMN "walletDelegated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "walletImported" BOOLEAN NOT NULL DEFAULT false;

-- Rollback:
--   ALTER TABLE "User" DROP COLUMN "walletDelegated";
--   ALTER TABLE "User" DROP COLUMN "walletImported";
