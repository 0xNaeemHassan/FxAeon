/**
 * Unit Tests for Macro Pulse & Growth Suite
 * Tests sentiment index classification, DCA projections, and Affiliate VIP tiers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 1. Sentiment Classification
function getSentimentClassification(score) {
  if (score < 25) return 'Extreme Fear';
  if (score < 45) return 'Fear';
  if (score <= 55) return 'Neutral';
  if (score <= 75) return 'Greed';
  return 'Extreme Greed';
}

// 2. DCA Strategy Math
function calculateDcaProjections(amountPerBuy, frequency, months = 6, estimatedRoiPct = 28) {
  const executionsPerMonth = frequency === 'daily' ? 30 : frequency === 'weekly' ? 4.33 : 1;
  const totalExecutions = Math.round(executionsPerMonth * months);
  const totalInvested = amountPerBuy * totalExecutions;
  const projectedValue = totalInvested * (1 + estimatedRoiPct / 100);
  return { totalExecutions, totalInvested, projectedValue };
}

// 3. Affiliate Tier Rebates
const VIP_TIERS = [
  { tier: 1, name: 'Bronze Pilot', minVolume: 0, rebatePct: 10 },
  { tier: 2, name: 'Silver Ambassador', minVolume: 25000, rebatePct: 20 },
  { tier: 3, name: 'Gold Whale Partner', minVolume: 100000, rebatePct: 30 },
];

function getAffiliateTier(totalReferredVolume) {
  return [...VIP_TIERS].reverse().find((t) => totalReferredVolume >= t.minVolume) || VIP_TIERS[0];
}

function calculateRebateAmount(feePaid, tier) {
  return (feePaid * tier.rebatePct) / 100;
}

test('getSentimentClassification correctly classifies Fear & Greed scores', () => {
  assert.equal(getSentimentClassification(15), 'Extreme Fear');
  assert.equal(getSentimentClassification(35), 'Fear');
  assert.equal(getSentimentClassification(50), 'Neutral');
  assert.equal(getSentimentClassification(72), 'Greed');
  assert.equal(getSentimentClassification(88), 'Extreme Greed');
});

test('calculateDcaProjections accurately computes capital invested and projected value', () => {
  // $50 weekly for 6 months (approx 26 buys = $1300 invested)
  const res = calculateDcaProjections(50, 'weekly', 6, 28);
  assert.equal(res.totalExecutions, 26);
  assert.equal(res.totalInvested, 1300);
  assert.equal(res.projectedValue.toFixed(2), '1664.00');
});

test('getAffiliateTier and rebate calculations enforce accurate VIP progression', () => {
  // Volume $10,000 -> Tier 1 Bronze (10%)
  const t1 = getAffiliateTier(10000);
  assert.equal(t1.tier, 1);
  assert.equal(t1.rebatePct, 10);
  assert.equal(calculateRebateAmount(100, t1), 10);

  // Volume $68,400 -> Tier 2 Silver (20%)
  const t2 = getAffiliateTier(68400);
  assert.equal(t2.tier, 2);
  assert.equal(t2.rebatePct, 20);
  assert.equal(calculateRebateAmount(200, t2), 40);

  // Volume $150,000 -> Tier 3 Gold (30%)
  const t3 = getAffiliateTier(150000);
  assert.equal(t3.tier, 3);
  assert.equal(t3.rebatePct, 30);
  assert.equal(calculateRebateAmount(500, t3), 150);
});
