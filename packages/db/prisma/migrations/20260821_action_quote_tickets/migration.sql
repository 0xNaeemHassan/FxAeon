-- Freeze each simulated Mini App action plan behind a short-lived,
-- authenticated, one-plan execution ticket. The original intent is retained
-- only as structured JSON; no private signing material is stored here.
CREATE TABLE "ActionQuoteTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionQuoteTicket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActionQuoteTicket_userId_idx" ON "ActionQuoteTicket"("userId");
CREATE INDEX "ActionQuoteTicket_expiresAt_idx" ON "ActionQuoteTicket"("expiresAt");

ALTER TABLE "ActionQuoteTicket"
ADD CONSTRAINT "ActionQuoteTicket_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
