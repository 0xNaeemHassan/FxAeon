'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Gauge,
  Sparkles,
} from 'lucide-react';
import { AppShell, Button, Card } from '@/components/ui';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';

interface MarketSentiment {
  market: string;
  longPct: number;
  shortPct: number;
  fundingRate8h: number;
  fundingAnnualized: number;
  liquidations24hUsd: number;
  bias: 'bullish' | 'bearish' | 'neutral';
}

const SENTIMENT_DATA: MarketSentiment[] = [
  {
    market: 'wstETH',
    longPct: 66,
    shortPct: 34,
    fundingRate8h: 0.0124,
    fundingAnnualized: 13.57,
    liquidations24hUsd: 28400000,
    bias: 'bullish',
  },
  {
    market: 'WBTC',
    longPct: 59,
    shortPct: 41,
    fundingRate8h: 0.0092,
    fundingAnnualized: 10.07,
    liquidations24hUsd: 35800000,
    bias: 'bullish',
  },
];

export default function MacroPulsePage() {
  const [fearGreedIndex] = useState(72); // 0 = Extreme Fear, 100 = Extreme Greed

  return (
    <AppShell title="Macro Pulse" subtitle="Real-time DeFi sentiment, funding rates, and market positioning.">
      <div className="stagger flex flex-col gap-3.5">
        {/* Fear & Greed Hero Card */}
        <Card glow className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full bg-[rgba(54,223,166,.16)] blur-3xl" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-success animate-ping" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint">
                  Market Sentiment Gauge
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-display text-[32px] font-bold text-success">
                  {fearGreedIndex}
                </span>
                <span className="text-[15px] font-bold text-white uppercase tracking-wider">
                  Greed
                </span>
              </div>
              <p className="mt-0.5 text-[11.5px] text-mut">
                Bullish momentum dominating. Retail leverage is elevated.
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint shadow-[0_0_20px_var(--mint-glow)]">
              <Gauge className="h-6 w-6" />
            </div>
          </div>

          {/* Sentiment Meter Bar */}
          <div className="mt-4">
            <div className="flex justify-between text-[10px] font-bold uppercase text-mut pb-1">
              <span className="text-danger">Extreme Fear (0)</span>
              <span className="text-white">Neutral (50)</span>
              <span className="text-success">Extreme Greed (100)</span>
            </div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
              <div
                className="h-full bg-gradient-to-r from-danger via-warn to-success rounded-full"
                style={{ width: '100%' }}
              />
              {/* Pointer Marker */}
              <div
                className="absolute top-0 h-full w-1.5 bg-white shadow-[0_0_8px_white] -translate-x-1/2"
                style={{ left: `${fearGreedIndex}%` }}
              />
            </div>
          </div>
        </Card>

        {/* Long / Short Positioning Skew */}
        <div>
          <h2 className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-mut">
            Market Positioning & Funding Radar
          </h2>

          <div className="flex flex-col gap-2.5">
            {SENTIMENT_DATA.map((item) => (
              <div key={item.market} className="glass p-4 transition-all">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[15px] text-white">{item.market} / fxUSD</span>
                    <span className="rounded-full bg-[var(--mint-dim)] px-2 py-0.5 text-[9.5px] font-bold text-mint uppercase">
                      {item.bias}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] font-bold text-mut">
                    8h Funding: +{(item.fundingRate8h * 100).toFixed(3)}%
                  </span>
                </div>

                {/* Long vs Short Ratio Bar */}
                <div className="my-2">
                  <div className="flex justify-between text-[11px] font-mono font-bold pb-1">
                    <span className="text-success">{item.longPct}% Longs</span>
                    <span className="text-danger">{item.shortPct}% Shorts</span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                    <div className="bg-success h-full" style={{ width: `${item.longPct}%` }} />
                    <div className="bg-danger h-full" style={{ width: `${item.shortPct}%` }} />
                  </div>
                </div>

                {/* Metric Grid */}
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[rgba(255,255,255,0.03)] p-2.5 text-[11.5px]">
                  <div>
                    <span className="block text-[9.5px] text-mut uppercase">Annualized Funding</span>
                    <span className="font-mono font-bold text-white">+{item.fundingAnnualized.toFixed(2)}% APY</span>
                  </div>
                  <div>
                    <span className="block text-[9.5px] text-mut uppercase">24h Liquidations</span>
                    <span className="font-mono font-bold text-danger">
                      ${(item.liquidations24hUsd / 1_000_000).toFixed(1)}M
                    </span>
                  </div>
                </div>

                {/* Action Link */}
                <div className="mt-3 flex items-center justify-end">
                  <Link
                    href={`/trade?market=${item.market}`}
                    onClick={() => {
                      sound.tap();
                      haptic('light');
                    }}
                  >
                    <Button variant="ghost" className="h-8 gap-1.5 text-[11.5px] font-bold text-mint">
                      Trade {item.market} <ArrowRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tactical Indicator Box */}
        <Card className="p-4 border border-mint/20 bg-[rgba(54,223,166,0.02)]">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-[13.5px] font-bold text-white">Tactical Alpha Signal</h3>
              <p className="mt-1 text-[11.5px] leading-relaxed text-mut">
                Long open interest is elevated on wstETH. Positive funding indicates long positions are paying shorts.
                Consider setting a <strong>Take-Profit target at +30%</strong> and maintaining a collateral health ratio above <strong>40%</strong> to absorb short squeezes or flash wicks.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
