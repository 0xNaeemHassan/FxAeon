-- NAV-vs-market arbitrage alerts (/arb on|off): the arb poller compares the
-- fxUSD NAV against the secondary market and pushes an opt-in alert when an
-- actionable edge opens. Default OFF; throttled via "lastArbAlert".
ALTER TABLE "NotificationPref" ADD COLUMN "arb" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NotificationPref" ADD COLUMN "lastArbAlert" TIMESTAMP(3);
