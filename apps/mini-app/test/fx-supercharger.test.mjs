/**
 * Unit Tests for f(x)oor Supercharger Suite
 * Tests Arb Spread calculation, Pilot XP leveling, and Collateral Guardian math.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 1. Arb Spread Math
function calculateArbSpread(marketPrice, navPrice = 1.0) {
  const spreadPct = ((navPrice - marketPrice) / navPrice) * 100;
  const profitPer10k = (spreadPct / 100) * 10000;
  return { spreadPct, profitPer10k };
}

// 2. Pilot XP Leveling Math
const RANKS = [
  { level: 1, name: 'Novice Cadet', minXp: 0 },
  { level: 2, name: 'Leverage Pilot', minXp: 1000 },
  { level: 3, name: 'Stability Guardian', minXp: 2500 },
  { level: 4, name: 'Cross-Chain Nomad', minXp: 4500 },
  { level: 5, name: 'Apex f(x)oor', minXp: 7000 },
];

function getPilotRank(totalXp) {
  const rank = [...RANKS].reverse().find((r) => totalXp >= r.minXp) || RANKS[0];
  const nextRank = RANKS.find((r) => r.level === rank.level + 1);
  const xpInLevel = totalXp - rank.minXp;
  const xpNeeded = nextRank ? nextRank.minXp - rank.minXp : 1000;
  const progressPct = nextRank ? Math.min(100, Math.round((xpInLevel / xpNeeded) * 100)) : 100;
  return { rank, nextRank, progressPct };
}

// 3. Collateral Guardian Liquidation Buffer Simulation
function simulateGuardianBuffer(spotPrice, collateralUsd, debtUsd, boostPct) {
  const additionalCollateral = (collateralUsd * boostPct) / 100;
  const newCollateral = collateralUsd + additionalCollateral;
  const collateralRatio = debtUsd > 0 ? newCollateral / debtUsd : 1.5;
  const priceDropTolerancePct = Math.min(95, Math.max(5, (1 - 1 / collateralRatio) * 100));
  const newLiquidationPrice = spotPrice * (1 - priceDropTolerancePct / 100);
  return { newLiquidationPrice, priceDropTolerancePct };
}

test('calculateArbSpread computes accurate spread and profit per 10k', () => {
  // fxUSD at $0.9950 against $1.0000 NAV is a 0.5% discount ($50 profit per $10k)
  const res = calculateArbSpread(0.9950, 1.0000);
  assert.equal(res.spreadPct.toFixed(2), '0.50');
  assert.equal(res.profitPer10k.toFixed(2), '50.00');
});

test('getPilotRank accurately maps XP points to ranks and progress percentages', () => {
  // 500 XP -> Level 1 (50% progress to Level 2)
  const p1 = getPilotRank(500);
  assert.equal(p1.rank.level, 1);
  assert.equal(p1.rank.name, 'Novice Cadet');
  assert.equal(p1.progressPct, 50);

  // 2600 XP -> Level 3 Stability Guardian
  const p2 = getPilotRank(2600);
  assert.equal(p2.rank.level, 3);
  assert.equal(p2.rank.name, 'Stability Guardian');

  // 7500 XP -> Level 5 Apex f(x)oor (100% progress)
  const p3 = getPilotRank(7500);
  assert.equal(p3.rank.level, 5);
  assert.equal(p3.rank.name, 'Apex f(x)oor');
  assert.equal(p3.progressPct, 100);
});

test('simulateGuardianBuffer calculates increased liquidation safety cushion', () => {
  const spotPrice = 3000;
  const collateralUsd = 1000;
  const debtUsd = 600;

  // With +50% collateral, safety buffer expands
  const base = simulateGuardianBuffer(spotPrice, collateralUsd, debtUsd, 0);
  const boosted = simulateGuardianBuffer(spotPrice, collateralUsd, debtUsd, 50);

  assert.ok(boosted.newLiquidationPrice < base.newLiquidationPrice, 'Boosted liq price must be lower than base');
  assert.ok(boosted.priceDropTolerancePct > base.priceDropTolerancePct, 'Price drop tolerance must increase');
});
