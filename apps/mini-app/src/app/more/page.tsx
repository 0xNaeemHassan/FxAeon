'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  Banknote,
  BookOpen,
  CandlestickChart,
  ChevronRight,
  CircleHelp,
  Layers2,
  QrCode,
  Settings,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { AppShell, AddressChip, Card } from '@/components/ui';
import { haptic } from '@/lib/telegram';
import { privyConfigured } from '@/lib/privyConfig';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';

/**
 * The More tab is intentionally a small map of the official f(x) surface.
 * It is not a feature marketplace: every primary row lands on a supported
 * SDK flow, while protocol links remain informational and external.
 */
export default function MorePage() {
  return (
    <AppShell title="Explore" subtitle="Everything FxAeon can do, in one calm place.">
      <div className="stagger flex flex-col gap-5">
        {privyConfigured() ? <WalletSummary /> : <WalletNotConfigured />}

        <Section label="f(x) protocol">
          <MoreRow href="/positions" icon={Layers2} title="Positions" body="Read, reduce, close, or adjust leverage" />
          <MoreRow href="/borrow" icon={Banknote} title="Borrow fxUSD" body="Deposit collateral, mint, repay, or withdraw" />
          <MoreRow href="/earn" icon={Wallet} title="fxSAVE" body="Read balances, deposit, redeem, and claim" />
          <MoreRow href="/move" icon={ArrowLeftRight} title="Bridge" body="Move supported assets between Ethereum and Base" />
        </Section>

        <Section label="Wallet">
          <MoreRow href="/qr" icon={QrCode} title="Receive assets" body="Copy your wallet address or show a QR code" />
          <MoreRow href="/settings" icon={Settings} title="Settings" body="Wallet, theme, and slippage preferences" />
        </Section>

        <Section label="Shortcuts">
          <MoreRow href="/trade" icon={CandlestickChart} title="Trade" body="Open or increase an f(x) position" />
          <MoreRow href="/borrow" icon={Banknote} title="Borrow" body="Mint or manage fxUSD against collateral" />
        </Section>

        <Section label="Learn">
          <MoreRow external href="https://fx.aladdin.club/" icon={BookOpen} title="f(x) Protocol" body="Official interface and protocol resources" />
          <MoreRow external href="https://docs.aladdin.club/fx-protocol" icon={CircleHelp} title="Protocol docs" body="Markets, mechanics, and risk disclosures" />
        </Section>

        <Card className="border-[rgba(139,109,255,.22)] bg-[rgba(139,109,255,.06)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-mint">Client-first by design</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-mut">
            Reads come from the official SDK and public chains. FxAeon never invents balances, prices, or execution history, and every transaction stays behind your wallet’s confirmation.
          </p>
        </Card>

        <p className="pb-2 text-center text-[9.5px] uppercase tracking-[0.14em] text-[var(--mut-2)]">FxAeon · official f(x) SDK · Ethereum + Base</p>
      </div>
    </AppShell>
  );
}

function WalletSummary() {
  const { ready, authenticated } = usePrivy();
  const walletState = usePrivyWallet();
  const wallet = walletState.selectedWallet;
  const timedOut = useWalletReadyTimeout(ready && walletState.ready);

  if (!ready || !walletState.ready) {
    if (timedOut) {
      return <Card className="border-[rgba(255,194,102,.24)]"><p className="text-[13px] font-semibold">Wallet provider did not load</p><p className="mt-1 text-[11px] leading-relaxed text-mut">No wallet state was assumed. Reload after checking your connection or Telegram version.</p><button type="button" onClick={() => window.location.reload()} className="button button-primary mt-3 min-h-11 w-full rounded-2xl px-4">Reload</button></Card>;
    }
    return <Card className="h-24 animate-pulse"><span className="sr-only">Loading wallet</span></Card>;
  }

  if (!authenticated || !wallet) {
    return (
      <Card glow className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint"><Wallet className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mut">Wallet</p>
            <p className="mt-1 text-[13px] font-medium">Connect to read your on-chain state</p>
            <p className="mt-1 text-[11px] leading-relaxed text-mut">No wallet or balance is assumed until Privy and the selected chain confirm it.</p>
          </div>
        </div>
        <Link href="/login" className="button button-primary glass-press mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl px-4 py-3 text-[15px] font-semibold">{authenticated ? 'Choose wallet' : 'Connect wallet'}</Link>
      </Card>
    );
  }

  return (
    <Card glow className="p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint"><Wallet className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mut">Connected wallet</p>
          <div className="mt-1"><AddressChip address={wallet.address} /></div>
        </div>
        <span className="rounded-full bg-[var(--success-dim)] px-2 py-1 text-[9px] font-bold uppercase text-success">Ready</span>
      </div>
    </Card>
  );
}

function WalletNotConfigured() {
  return (
    <Card className="border-[rgba(255,194,102,.24)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-warn">Wallet unavailable</p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-mut">This build has no Privy application configured. Protocol pages will remain read-only until a wallet provider is available.</p>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const id = `more-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.17em] text-mut">{label}</h2>
      <div className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--surface)] divide-y divide-[var(--line)]">{children}</div>
    </section>
  );
}

function MoreRow({ href, icon: Icon, title, body, external = false }: { href: string; icon: LucideIcon; title: string; body: string; external?: boolean }) {
  const inner = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{title}</span><span className="mt-0.5 block truncate text-[10.5px] text-mut">{body}</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--mut-2)]" aria-hidden="true" />
    </>
  );
  const cls = 'glass-press flex min-h-[68px] items-center gap-3 px-3.5 py-3';
  if (external) return <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => haptic('light')} className={cls}>{inner}</a>;
  return <Link href={href} onClick={() => haptic('light')} className={cls}>{inner}</Link>;
}
