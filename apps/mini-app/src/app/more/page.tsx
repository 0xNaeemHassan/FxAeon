'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Banknote,
  BookOpen,
  Bot,
  ChevronRight,
  CircleHelp,
  Compass,
  Layers2,
  QrCode,
  RefreshCw,
  Scale,
  Settings,
  ShieldCheck,
  Trophy,
  Wallet,
  Waves,
} from 'lucide-react';
import Link from 'next/link';
import { AppShell, AddressChip, Button, Card, LoadingRegion, Skeleton } from '@/components/ui';
import { getMe, type Me } from '@/lib/api';
import { haptic } from '@/lib/telegram';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

export default function MorePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setMe(await getMe());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Wallet status is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <AppShell title="More" subtitle="Your complete f(x) toolkit, wallet controls, and transaction history.">
      <div className="stagger flex flex-col gap-3.5">
        {loading ? <LoadingRegion label="Loading wallet status"><Skeleton className="h-24" /></LoadingRegion> : me?.walletAddress && (
          <Card glow className="p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint"><Wallet className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mut">Trading wallet</p>
                <div className="mt-1"><AddressChip address={me.walletAddress} /></div>
              </div>
              <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${me.walletDelegated ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--warn-dim)] text-warn'}`}>
                {me.walletDelegated ? 'Signer on' : 'Signer off'}
              </span>
            </div>
          </Card>
        )}

        {!loading && error && (
          <Card className="border-[rgba(255,194,102,.24)] p-3.5">
            <p role="alert" className="text-[11.5px] leading-relaxed text-warn">Wallet status unavailable: {error}</p>
            <Button variant="ghost" className="mt-2" onClick={() => void load()}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" /> Retry wallet status
            </Button>
          </Card>
        )}

        <Section label="f(x)oor Intelligence">
          <MoreRow href="/radar" icon={Scale} title="Arb Radar" body="Real-time fxUSD peg discount & redemption spread" />
          <MoreRow href="/whales" icon={Waves} title="Whale Watcher" body="Live $50k+ smart-money protocol transaction feed" />
          <MoreRow href="/quests" icon={Compass} title="f(x) Quests & XP" body="Season 1 pilot achievements and badge rewards" />
          <MoreRow href="/leaderboard" icon={Trophy} title="Community Leaderboard" body="Top performing PnL traders and win streaks" />
        </Section>

        <Section label="Protocol">
          <MoreRow href="/positions" icon={Layers2} title="Positions" body="Increase, reduce, close, and adjust leverage" />
          <MoreRow href="/borrow" icon={Banknote} title="Borrow fxUSD" body="Deposit collateral, mint, repay, and release" />
          <MoreRow href="/activity" icon={Activity} title="Activity" body="On-chain execution journal and receipts" />
        </Section>

        <Section label="Wallet & safety">
          <MoreRow href="/qr" icon={QrCode} title="Receive assets" body="Address and scannable deposit QR" />
          <MoreRow href="/settings" icon={Settings} title="Settings" body="Signer grant, slippage, MEV, and language" />
          <MoreRow href="/policy" icon={ShieldCheck} title="Execution policy" body="See what the delegated signer is allowed to do" />
        </Section>

        <Section label="Resources">
          <MoreRow external href={`https://t.me/${BOT_USERNAME}`} icon={Bot} title="Open chat bot" body="Commands, alerts, automation, and support" />
          <MoreRow external href="https://fx.aladdin.club/" icon={BookOpen} title="f(x) Protocol" body="Official protocol interface and resources" />
          <MoreRow external href="https://docs.aladdin.club/fx-protocol" icon={CircleHelp} title="Protocol docs" body="Learn about markets, risks, and mechanics" />
        </Section>

        <p className="pb-2 text-center text-[9.5px] uppercase tracking-[0.14em] text-[var(--mut-2)]">FxAeon · f(x) on your phone · Ethereum + Base</p>
      </div>
    </AppShell>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><h2 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.17em] text-mut">{label}</h2><div className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--surface)] divide-y divide-[var(--line)]">{children}</div></div>;
}

function MoreRow({ href, icon: Icon, title, body, external = false }: { href: string; icon: typeof Activity; title: string; body: string; external?: boolean }) {
  const inner = <><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Icon className="h-[18px] w-[18px]" /></span><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{title}</span><span className="mt-0.5 block truncate text-[10.5px] text-mut">{body}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-[var(--mut-2)]" /></>;
  const cls = 'glass-press flex min-h-[68px] items-center gap-3 px-3.5 py-3';
  if (external) return <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => haptic('light')} className={cls}>{inner}</a>;
  return <Link href={href} onClick={() => haptic('light')} className={cls}>{inner}</Link>;
}
