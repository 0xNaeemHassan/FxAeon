'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowRight,
  Calculator,
  Scale,
  Sparkles,
  Zap,
} from 'lucide-react';
import { AppShell, Button, Card } from '@/components/ui';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';

interface ArbOpportunity {
  id: string;
  type: 'discount' | 'premium' | 'rebalance';
  title: string;
  spreadPct: number;
  expectedProfitPer10k: number;
  source: string;
  target: string;
  actionHref: string;
  actionLabel: string;
  riskLevel: 'Low' | 'Medium';
}

const LIVE_OPPORTUNITIES: ArbOpportunity[] = [
  {
    id: 'fxusd_curve_discount',
    type: 'discount',
    title: 'fxUSD Peg Discount on Curve',
    spreadPct: 0.38,
    expectedProfitPer10k: 38.0,
    source: 'Curve fxUSD/USDC ($0.9962)',
    target: 'f(x) Protocol NAV ($1.0000)',
    actionHref: '/earn',
    actionLabel: 'Buy & Redeem at NAV',
    riskLevel: 'Low',
  },
  {
    id: 'wsteth_stability_rebalance',
    type: 'rebalance',
    title: 'wstETH Stability Pool Liquidation Premium',
    spreadPct: 1.85,
    expectedProfitPer10k: 185.0,
    source: 'fxSAVE Stability Vault',
    target: 'Discounted wstETH Collateral',
    actionHref: '/earn',
    actionLabel: 'Deposit in fxSAVE',
    riskLevel: 'Low',
  },
  {
    id: 'wbtc_mint_arb',
    type: 'premium',
    title: 'WBTC Vault Mint-Arb Spread',
    spreadPct: 0.42,
    expectedProfitPer10k: 42.0,
    source: 'f(x) Protocol Mint ($1.0000)',
    target: 'Uniswap v3 Pool ($1.0042)',
    actionHref: '/trade',
    actionLabel: 'Mint & Sell fxUSD',
    riskLevel: 'Low',
  },
];

export default function ArbRadarPage() {
  const [depositAmount, setDepositAmount] = useState('5000');
  const parsedDeposit = parseFloat(depositAmount) || 0;
  const estimatedAnnualYield = parsedDeposit * 0.124; // 12.4% APY
  const estimatedMonthlyYield = estimatedAnnualYield / 12;

  return (
    <AppShell title="Arb Radar" subtitle="Real-time f(x) peg arbitrage scanner and stability yield matrix.">
      <div className="stagger flex flex-col gap-3.5">
        {/* Peg Status Hero */}
        <Card glow className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full bg-[rgba(54,223,166,.16)] blur-3xl" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint">
                Peg Health & Arbitrage
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-display text-[26px] font-bold text-white">$0.9962</span>
                <span className="flex items-center text-[12px] font-bold text-warn">
                  <ArrowDownRight className="h-3.5 w-3.5" /> -0.38% Spread
                </span>
              </div>
              <p className="mt-1 text-[11.5px] text-mut">
                fxUSD is trading at a discount. Instant redemption arbitrage is active.
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint shadow-[0_0_20px_var(--mint-glow)]">
              <Scale className="h-6 w-6" />
            </div>
          </div>
        </Card>

        {/* Live Opportunities List */}
        <div>
          <h2 className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-mut">
            Active Spread Opportunities
          </h2>
          <div className="flex flex-col gap-2.5">
            {LIVE_OPPORTUNITIES.map((opp) => (
              <div key={opp.id} className="glass p-4 transition-all">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--mint-dim)] text-mint">
                      <Zap className="h-3.5 w-3.5" />
                    </span>
                    <span className="font-semibold text-[13.5px]">{opp.title}</span>
                  </div>
                  <span className="rounded-full bg-success/15 px-2.5 py-0.5 font-mono text-[11.5px] font-bold text-success">
                    +{opp.spreadPct.toFixed(2)}% Spread
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[rgba(255,255,255,0.03)] p-2.5 text-[11px]">
                  <div>
                    <span className="block text-[9.5px] text-mut uppercase">Source</span>
                    <span className="font-medium text-white">{opp.source}</span>
                  </div>
                  <div>
                    <span className="block text-[9.5px] text-mut uppercase">Destination</span>
                    <span className="font-medium text-white">{opp.target}</span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[11px] text-mut">
                    Est. Profit: <strong className="text-white">+${opp.expectedProfitPer10k.toFixed(2)}</strong> per $10k
                  </span>
                  <Link
                    href={opp.actionHref}
                    onClick={() => {
                      sound.tap();
                      haptic('light');
                    }}
                  >
                    <Button variant="ghost" className="h-8 gap-1.5 text-[11.5px] font-bold text-mint">
                      {opp.actionLabel} <ArrowRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stability Yield Calculator */}
        <Card className="p-4.5">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="h-4 w-4 text-mint" />
            <h3 className="text-[14px] font-bold">fxSAVE Compound Calculator</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-mut">fxUSD Deposit Size</label>
              <div className="relative mt-1">
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[14px] font-bold focus:border-mint focus:outline-none"
                  placeholder="5000"
                />
                <span className="absolute right-3 top-2 text-[12px] font-bold text-mut">fxUSD</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-xl bg-[rgba(255,255,255,0.03)] p-3 text-[11.5px]">
              <div>
                <span className="block text-[10px] text-mut">Est. Monthly Return</span>
                <span className="text-display text-[15px] font-bold text-success">
                  +${estimatedMonthlyYield.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] text-mut">Est. Annual Yield (12.4% APY)</span>
                <span className="text-display text-[15px] font-bold text-success">
                  +${estimatedAnnualYield.toFixed(2)}
                </span>
              </div>
            </div>

            <Link
              href="/earn"
              onClick={() => {
                sound.confirm();
                haptic('medium');
              }}
              className="block"
            >
              <Button className="w-full gap-2 text-[13px]">
                <Sparkles className="h-4 w-4" /> Deposit in fxSAVE Stability Vault
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
