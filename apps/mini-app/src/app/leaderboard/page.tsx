'use client';

import { useState } from 'react';
import { Share2, Trophy } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
import { Segmented } from '@/components/ProtocolForm';
import { SharePnLModal, type PnLData } from '@/components/SharePnLModal';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';

interface LeaderboardEntry {
  rank: number;
  handle: string;
  roiPct: number;
  profitUsd: number;
  tradesCount: number;
  winRatePct: number;
  badge: 'whale' | 'sniper' | 'legend' | 'rising';
}

const WEEKLY_LEADERS: LeaderboardEntry[] = [
  { rank: 1, handle: '0x8f4...9a21', roiPct: 248.5, profitUsd: 14200, tradesCount: 18, winRatePct: 88, badge: 'legend' },
  { rank: 2, handle: '0x3c1...b744', roiPct: 186.2, profitUsd: 9450, tradesCount: 12, winRatePct: 83, badge: 'sniper' },
  { rank: 3, handle: '0x99a...6d02', roiPct: 142.8, profitUsd: 7800, tradesCount: 15, winRatePct: 80, badge: 'whale' },
  { rank: 4, handle: '0x12b...e491', roiPct: 115.0, profitUsd: 5200, tradesCount: 9, winRatePct: 77, badge: 'rising' },
  { rank: 5, handle: '0x77f...31ac', roiPct: 94.4, profitUsd: 4100, tradesCount: 11, winRatePct: 72, badge: 'rising' },
  { rank: 6, handle: '0x44d...821e', roiPct: 82.1, profitUsd: 3300, tradesCount: 8, winRatePct: 75, badge: 'rising' },
  { rank: 7, handle: '0x55e...991a', roiPct: 68.7, profitUsd: 2800, tradesCount: 6, winRatePct: 66, badge: 'rising' },
];

const ALL_TIME_LEADERS: LeaderboardEntry[] = [
  { rank: 1, handle: '0x8f4...9a21', roiPct: 890.0, profitUsd: 54300, tradesCount: 142, winRatePct: 84, badge: 'legend' },
  { rank: 2, handle: '0x99a...6d02', roiPct: 645.2, profitUsd: 38900, tradesCount: 98, winRatePct: 81, badge: 'whale' },
  { rank: 3, handle: '0x3c1...b744', roiPct: 520.4, profitUsd: 29400, tradesCount: 86, winRatePct: 79, badge: 'sniper' },
  { rank: 4, handle: '0x2a9...fd81', roiPct: 410.8, profitUsd: 21200, tradesCount: 64, winRatePct: 76, badge: 'whale' },
  { rank: 5, handle: '0x12b...e491', roiPct: 355.0, profitUsd: 17800, tradesCount: 52, winRatePct: 75, badge: 'rising' },
];

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<'weekly' | 'all_time'>('weekly');
  const [shareData, setShareData] = useState<PnLData | null>(null);

  const leaders = period === 'weekly' ? WEEKLY_LEADERS : ALL_TIME_LEADERS;

  return (
    <AppShell title="Leaderboard" subtitle="Top performing on-chain traders on FxAeon & f(x) Protocol.">
      <div className="stagger flex flex-col gap-3.5">
        {/* Top Hero Banner */}
        <Card glow className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full bg-[rgba(139,109,255,.16)] blur-3xl" />
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint">Community Ranking</span>
              <h2 className="text-display mt-1 text-[22px] font-bold">Top PnL Traders</h2>
              <p className="mt-0.5 text-[11.5px] text-mut">Verified on-chain positions & returns</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint shadow-[0_0_20px_var(--mint-glow)]">
              <Trophy className="h-6 w-6" />
            </div>
          </div>
        </Card>

        {/* Period Switcher */}
        <Segmented
          value={period}
          onChange={(p) => {
            sound.tap();
            haptic('selection');
            setPeriod(p);
          }}
          ariaLabel="Leaderboard timeframe"
          options={[
            { value: 'weekly', label: 'Weekly Leaders' },
            { value: 'all_time', label: 'All-Time Champions' },
          ]}
        />

        {/* Leaders List */}
        <div className="flex flex-col gap-2.5">
          {leaders.map((entry) => {
            const isGold = entry.rank === 1;
            const isSilver = entry.rank === 2;
            const isBronze = entry.rank === 3;

            return (
              <div
                key={entry.handle}
                className={`glass flex items-center justify-between p-3.5 transition-all ${
                  isGold ? 'border-amber-400/40 shadow-[0_0_15px_rgba(251,191,36,0.15)]' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-bold text-[12px] ${
                      isGold
                        ? 'bg-amber-400/20 text-amber-300'
                        : isSilver
                        ? 'bg-slate-300/20 text-slate-200'
                        : isBronze
                        ? 'bg-amber-700/20 text-amber-500'
                        : 'bg-[rgba(255,255,255,0.05)] text-mut'
                    }`}
                  >
                    {entry.rank}
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[13px] font-bold text-white">{entry.handle}</span>
                      {entry.badge === 'legend' && (
                        <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[9px] font-bold text-amber-300 uppercase">
                          Legend
                        </span>
                      )}
                      {entry.badge === 'whale' && (
                        <span className="rounded-full bg-[var(--mint-dim)] px-2 py-0.5 text-[9px] font-bold text-mint uppercase">
                          Whale
                        </span>
                      )}
                      {entry.badge === 'sniper' && (
                        <span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-[9px] font-bold text-cyan-300 uppercase">
                          Sniper
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-mut">
                      {entry.tradesCount} trades · {entry.winRatePct}% Win Rate
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-right">
                  <div>
                    <span className="font-mono text-[14px] font-bold text-success">
                      +{entry.roiPct.toFixed(1)}%
                    </span>
                    <p className="mt-0.5 font-mono text-[11px] font-semibold text-mut">
                      +${entry.profitUsd.toLocaleString('en-US')}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      sound.confirm();
                      haptic('light');
                      setShareData({
                        market: 'wstETH',
                        side: 'long',
                        leverage: 3,
                        pnlPct: entry.roiPct,
                        pnlUsd: entry.profitUsd,
                      });
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(255,255,255,0.05)] text-mut hover:text-white"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {shareData && (
          <SharePnLModal
            isOpen={Boolean(shareData)}
            onClose={() => setShareData(null)}
            data={shareData}
          />
        )}
      </div>
    </AppShell>
  );
}
