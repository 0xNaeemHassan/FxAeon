'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Copy,
  Waves,
} from 'lucide-react';
import { AppShell, Button, Card } from '@/components/ui';
import { Segmented } from '@/components/ProtocolForm';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';

interface WhaleEvent {
  id: string;
  type: 'leverage' | 'mint' | 'liquidation' | 'repay';
  whaleAddress: string;
  market: string;
  side?: 'long' | 'short';
  leverage?: number;
  amountUsd: number;
  details: string;
  timestamp: string;
  chain: 'Ethereum' | 'Base';
  txHash: string;
}

const WHALE_FEED: WhaleEvent[] = [
  {
    id: 'w1',
    type: 'leverage',
    whaleAddress: '0x3b89f5...2a19',
    market: 'wstETH',
    side: 'long',
    leverage: 7.5,
    amountUsd: 145000,
    details: 'Opened 7.5x Long on wstETH with $145k collateral',
    timestamp: '2m ago',
    chain: 'Ethereum',
    txHash: '0x8f2a...91bc',
  },
  {
    id: 'w2',
    type: 'mint',
    whaleAddress: '0x991a0c...44fe',
    market: 'WBTC',
    amountUsd: 250000,
    details: 'Minted 250,000 fxUSD against 2.65 WBTC',
    timestamp: '8m ago',
    chain: 'Base',
    txHash: '0x3e11...55da',
  },
  {
    id: 'w3',
    type: 'liquidation',
    whaleAddress: '0x55dc12...bb71',
    market: 'wstETH',
    amountUsd: 68400,
    details: 'fxSAVE Stability Pool absorbed $68.4k undercollateralized debt',
    timestamp: '19m ago',
    chain: 'Ethereum',
    txHash: '0x44ab...8821',
  },
  {
    id: 'w4',
    type: 'leverage',
    whaleAddress: '0x71ee90...00fa',
    market: 'WBTC',
    side: 'short',
    leverage: 5.0,
    amountUsd: 92000,
    details: 'Opened 5.0x Short on WBTC targeting $92k notional',
    timestamp: '34m ago',
    chain: 'Ethereum',
    txHash: '0x12dc...66fa',
  },
  {
    id: 'w5',
    type: 'mint',
    whaleAddress: '0x44a891...33d8',
    market: 'wstETH',
    amountUsd: 110000,
    details: 'Minted 110,000 fxUSD collateralized by 31.4 wstETH',
    timestamp: '52m ago',
    chain: 'Base',
    txHash: '0x77ee...33bb',
  },
];

export default function WhaleWatcherPage() {
  const [filter, setFilter] = useState<'all' | 'leverage' | 'mints'>('all');

  const filteredFeed = WHALE_FEED.filter((item) => {
    if (filter === 'leverage') return item.type === 'leverage';
    if (filter === 'mints') return item.type === 'mint';
    return true;
  });

  return (
    <AppShell title="Whale Watcher" subtitle="Live smart-money transaction flow on f(x) Protocol.">
      <div className="stagger flex flex-col gap-3.5">
        {/* Live Status Card */}
        <Card glow className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full bg-[rgba(139,109,255,.16)] blur-3xl" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-success animate-ping" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint">
                  Live RPC Mempool & Event Feed
                </span>
              </div>
              <h2 className="text-display mt-1 text-[22px] font-bold">Smart Money Flow</h2>
              <p className="mt-0.5 text-[11.5px] text-mut">Tracking $50,000+ protocol transactions</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint shadow-[0_0_20px_var(--mint-glow)]">
              <Waves className="h-6 w-6" />
            </div>
          </div>
        </Card>

        {/* Filter Segment */}
        <Segmented
          value={filter}
          onChange={(f) => {
            sound.tap();
            haptic('selection');
            setFilter(f);
          }}
          ariaLabel="Whale filter"
          options={[
            { value: 'all', label: 'All Whales' },
            { value: 'leverage', label: 'Big Leverage (5x+)' },
            { value: 'mints', label: 'Mints ($50k+)' },
          ]}
        />

        {/* Feed Items */}
        <div className="flex flex-col gap-2.5">
          {filteredFeed.map((event) => {
            const isLong = event.side === 'long';

            return (
              <div key={event.id} className="glass p-4 transition-all">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-bold text-white">{event.whaleAddress}</span>
                    <span className="rounded-md bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5 text-[10px] text-mut">
                      {event.chain}
                    </span>
                  </div>
                  <span className="text-[11px] text-mut">{event.timestamp}</span>
                </div>

                <div className="my-2 flex items-center justify-between">
                  <div>
                    <span className="block text-[13px] font-semibold text-white">{event.details}</span>
                    <span className="mt-0.5 block font-mono text-[14px] font-bold text-gradient">
                      ${event.amountUsd.toLocaleString('en-US')}
                    </span>
                  </div>

                  {event.type === 'leverage' && event.leverage && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        isLong ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'
                      }`}
                    >
                      {isLong ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                      {event.market} {event.leverage}x
                    </span>
                  )}

                  {event.type === 'mint' && (
                    <span className="rounded-full bg-[var(--mint-dim)] px-2.5 py-1 text-[11px] font-bold text-mint">
                      fxUSD Mint
                    </span>
                  )}

                  {event.type === 'liquidation' && (
                    <span className="rounded-full bg-warn/20 px-2.5 py-1 text-[11px] font-bold text-warn">
                      Stability Premium
                    </span>
                  )}
                </div>

                {/* Copy Setup Action */}
                {event.type === 'leverage' && (
                  <div className="mt-3 flex items-center justify-end border-t border-[var(--line)] pt-2.5">
                    <Link
                      href={`/trade?market=${event.market}&side=${event.side}&leverage=${event.leverage}`}
                      onClick={() => {
                        sound.confirm();
                        haptic('medium');
                      }}
                    >
                      <Button variant="ghost" className="h-8 gap-1.5 text-[11.5px] font-bold text-mint">
                        <Copy className="h-3 w-3" /> Copy Trade Setup <ArrowRight className="h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
