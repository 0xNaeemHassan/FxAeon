'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ChevronRight,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { AppShell, Button, Card } from '@/components/ui';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';

interface Quest {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  completed: boolean;
  claimed: boolean;
  actionHref: string;
  actionLabel: string;
  badge: string;
}

const DEFAULT_QUESTS: Quest[] = [
  {
    id: 'q1',
    title: 'First Flight',
    description: 'Open your first f(x) leveraged position from the Trade terminal.',
    xpReward: 500,
    completed: true,
    claimed: true,
    actionHref: '/trade',
    actionLabel: 'Trade',
    badge: '🚀',
  },
  {
    id: 'q2',
    title: 'Velocity Trader',
    description: 'Execute a 5.0× or higher leverage position on wstETH or WBTC.',
    xpReward: 750,
    completed: true,
    claimed: false,
    actionHref: '/trade',
    actionLabel: 'Trade 5x',
    badge: '⚡',
  },
  {
    id: 'q3',
    title: 'Stability Guardian',
    description: 'Deposit fxUSD into the fxSAVE stability pool to earn liquidation rewards.',
    xpReward: 1000,
    completed: true,
    claimed: false,
    actionHref: '/earn',
    actionLabel: 'Deposit fxSAVE',
    badge: '🛡️',
  },
  {
    id: 'q4',
    title: 'Cross-Chain Hopper',
    description: 'Bridge fxUSD or fxSAVE between Ethereum Mainnet and Base via LayerZero.',
    xpReward: 1000,
    completed: false,
    claimed: false,
    actionHref: '/move',
    actionLabel: 'Bridge to Base',
    badge: '🌉',
  },
  {
    id: 'q5',
    title: 'Cyber Copilot',
    description: 'Use the offline Speech-to-Trade copilot bar to set up a position.',
    xpReward: 350,
    completed: true,
    claimed: true,
    actionHref: '/trade',
    actionLabel: 'Voice Trade',
    badge: '🎙️',
  },
  {
    id: 'q6',
    title: 'Smart Money Tracker',
    description: 'Inspect a smart-money transaction in the Whale Watcher feed.',
    xpReward: 400,
    completed: false,
    claimed: false,
    actionHref: '/whales',
    actionLabel: 'View Whales',
    badge: '🐋',
  },
];

const RANKS = [
  { level: 1, name: 'Novice Cadet', minXp: 0, icon: '🎖️' },
  { level: 2, name: 'Leverage Pilot', minXp: 1000, icon: '⚡' },
  { level: 3, name: 'Stability Guardian', minXp: 2500, icon: '🛡️' },
  { level: 4, name: 'Cross-Chain Nomad', minXp: 4500, icon: '🌉' },
  { level: 5, name: 'Apex f(x)oor', minXp: 7000, icon: '👑' },
];

export default function QuestsPage() {
  const [quests, setQuests] = useState<Quest[]>(DEFAULT_QUESTS);
  const [totalXp, setTotalXp] = useState(2600);

  // Load from local storage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('fxaeon_quests_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.quests) setQuests(parsed.quests);
        if (parsed.totalXp) setTotalXp(parsed.totalXp);
      }
    } catch {
      // ignore
    }
  }, []);

  const currentRank = [...RANKS].reverse().find((r) => totalXp >= r.minXp) || RANKS[0];
  const nextRank = RANKS.find((r) => r.level === currentRank.level + 1);
  const xpInLevel = totalXp - currentRank.minXp;
  const xpNeeded = nextRank ? nextRank.minXp - currentRank.minXp : 1000;
  const progressPct = nextRank ? Math.min(100, Math.round((xpInLevel / xpNeeded) * 100)) : 100;

  const handleClaim = (questId: string) => {
    const q = quests.find((item) => item.id === questId);
    if (!q || q.claimed || !q.completed) return;

    sound.success();
    haptic('success');

    const updatedQuests = quests.map((item) =>
      item.id === questId ? { ...item, claimed: true } : item
    );
    const updatedXp = totalXp + q.xpReward;

    setQuests(updatedQuests);
    setTotalXp(updatedXp);

    try {
      localStorage.setItem(
        'fxaeon_quests_state',
        JSON.stringify({ quests: updatedQuests, totalXp: updatedXp })
      );
    } catch {
      // ignore
    }
  };

  return (
    <AppShell title="f(x) Quests" subtitle="Season 1 Pilot progression, XP rewards, and trader achievements.">
      <div className="stagger flex flex-col gap-3.5">
        {/* Pilot Level Hero Card */}
        <Card glow className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full bg-[rgba(139,109,255,.18)] blur-3xl" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[18px]">{currentRank.icon}</span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mint">
                  Level {currentRank.level} Pilot
                </span>
              </div>
              <h2 className="text-display mt-1 text-[22px] font-bold">{currentRank.name}</h2>
              <p className="mt-0.5 text-[11.5px] text-mut">
                {totalXp.toLocaleString('en-US')} Total XP Earned
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint shadow-[0_0_20px_var(--mint-glow)]">
              <Trophy className="h-6 w-6" />
            </div>
          </div>

          {/* XP Progress Bar */}
          <div className="mt-4">
            <div className="flex justify-between text-[11px] font-medium text-mut pb-1">
              <span>{nextRank ? `Next: Level ${nextRank.level} (${nextRank.name})` : 'Max Rank Achieved'}</span>
              <span className="font-mono text-white">{progressPct}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
              <div
                className="h-full bg-gradient transition-all duration-500 rounded-full"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </Card>

        {/* Quests List */}
        <div>
          <h2 className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-mut">
            Active Season Quests
          </h2>

          <div className="flex flex-col gap-2.5">
            {quests.map((quest) => (
              <div
                key={quest.id}
                className={`glass flex items-center justify-between p-4 transition-all ${
                  quest.claimed ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(255,255,255,0.05)] text-[18px]">
                    {quest.badge}
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13.5px] font-bold text-white">{quest.title}</span>
                      <span className="rounded-full bg-[var(--mint-dim)] px-2 py-0.5 font-mono text-[10px] font-bold text-mint">
                        +{quest.xpReward} XP
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-mut max-w-[210px]">{quest.description}</p>
                  </div>
                </div>

                <div className="shrink-0 pl-2">
                  {quest.claimed ? (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-success">
                      <CheckCircle2 className="h-4 w-4" /> Claimed
                    </span>
                  ) : quest.completed ? (
                    <Button
                      onClick={() => handleClaim(quest.id)}
                      className="h-8 px-3 text-[11.5px] font-bold bg-success text-black hover:bg-success/90"
                    >
                      <Sparkles className="h-3 w-3" /> Claim
                    </Button>
                  ) : (
                    <Link
                      href={quest.actionHref}
                      onClick={() => {
                        sound.tap();
                        haptic('light');
                      }}
                    >
                      <Button variant="ghost" className="h-8 gap-1 px-2 text-[11.5px] text-mut hover:text-white">
                        {quest.actionLabel} <ChevronRight className="h-3 w-3" />
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
