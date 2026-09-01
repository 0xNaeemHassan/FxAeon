'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, BookOpen, Check, ChevronRight, CircleHelp, Moon, Palette, QrCode, Settings, Sun, Wallet } from 'lucide-react';
import Link from 'next/link';
import { AppShell, AddressChip, Card } from '@/components/ui';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';
import { applyTheme, getSavedTheme, THEMES, type ThemeId } from '@/lib/theme';

/** Secondary destinations only. Primary trading flows stay in the tab bar. */
export default function MorePage() {
  return (
    <AppShell title="More">
      <div className="flex flex-col gap-5">
        <WalletSummary />

        <AppearanceSection />

        <Section label="Account">
          <MoreRow href="/qr" icon={QrCode} title="Receive" body="Wallet address and QR code" />
          <MoreRow href="/settings" icon={Settings} title="Settings" body="Wallet and preferences" />
        </Section>

        <Section label="Resources">
          <MoreRow external href="https://fx.aladdin.club/" icon={BookOpen} title="f(x) Protocol" body="Open the protocol app" />
          <MoreRow external href="https://fxprotocol.gitbook.io/fx-docs" icon={CircleHelp} title="Documentation" body="Markets, mechanics, and risks" />
        </Section>
      </div>
    </AppShell>
  );
}

const FEATURED_THEMES = ['violet', 'black', 'light'] as const satisfies readonly ThemeId[];
const THEME_LABELS: Record<(typeof FEATURED_THEMES)[number], string> = {
  violet: 'Official',
  black: 'Black',
  light: 'Light',
};

function AppearanceSection() {
  const [theme, setTheme] = useState<ThemeId>('violet');

  useEffect(() => setTheme(getSavedTheme()), []);

  return (
    <section aria-labelledby="more-theme">
      <h2 id="more-theme" className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-mut"><Palette className="h-3.5 w-3.5" aria-hidden="true" /> Theme</h2>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
        {FEATURED_THEMES.map((themeKey) => {
          const config = THEMES[themeKey];
          const active = theme === themeKey;
          const Icon = themeKey === 'light' ? Sun : themeKey === 'black' ? Moon : Palette;
          return (
            <button
              key={themeKey}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${THEME_LABELS[themeKey]} theme`}
              onClick={() => {
                setTheme(themeKey);
                applyTheme(themeKey);
                haptic('selection');
              }}
              className={`relative flex min-h-[78px] flex-col items-start justify-between rounded-lg border p-3 text-left transition-colors ${active ? 'border-[var(--mint)] bg-[var(--mint-dim)]' : 'border-[var(--line)] bg-[var(--surface)]'}`}
            >
              <span className="flex w-full items-center justify-between">
                <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line)]" style={{ backgroundColor: config.colors['--bg'] }}>
                  <Icon className="h-3.5 w-3.5" style={{ color: config.accent }} aria-hidden="true" />
                </span>
                {active && <Check className="h-4 w-4 text-mint" aria-hidden="true" />}
              </span>
              <span className="mt-2 text-[12px] font-semibold">{THEME_LABELS[themeKey]}</span>
            </button>
          );
        })}
      </div>
      <Link href="/settings" className="mt-2 inline-flex min-h-11 items-center px-1 text-[11px] font-semibold text-mint">More appearance options <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></Link>
    </section>
  );
}

function WalletSummary() {
  const walletState = usePrivyWallet();
  const { ready, authenticated } = walletState;
  const wallet = walletState.selectedWallet;
  const timedOut = useWalletReadyTimeout(ready && walletState.ready);

  if (!ready || !walletState.ready) {
    if (timedOut) {
      return (
        <Card className="border-[rgba(255,194,102,.24)]">
          <p className="text-[13px] font-semibold">Wallet provider did not load</p>
          <p className="mt-1 text-[12px] leading-relaxed text-mut">Wallet status is unavailable. Reload to try again.</p>
          <button type="button" onClick={() => window.location.reload()} className="button button-primary glass-press mt-3 flex min-h-11 w-full items-center justify-center rounded-xl px-4">
            Reload
          </button>
        </Card>
      );
    }
    return <Card className="h-20 animate-pulse"><span className="sr-only">Loading wallet</span></Card>;
  }

  if (!authenticated || !wallet) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <Wallet className="h-5 w-5 shrink-0 text-mint" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">Connect a wallet</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-mut">Your wallet and address appear here after connection.</p>
        </div>
        <Link href="/login" aria-label={authenticated ? 'Choose wallet' : 'Connect wallet'} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Link>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Wallet className="h-5 w-5 shrink-0 text-mint" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-mut">Connected wallet</p>
          <div className="mt-1"><AddressChip address={wallet.address} /></div>
        </div>
        <span className="text-[12px] font-medium text-success">Ready</span>
      </div>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const id = `more-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-mut">{label}</h2>
      <div className="divide-y divide-[var(--line)] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">{children}</div>
    </section>
  );
}

function MoreRow({ href, icon: Icon, title, body, external = false }: { href: string; icon: LucideIcon; title: string; body: string; external?: boolean }) {
  const inner = (
    <>
      <Icon className="h-[18px] w-[18px] shrink-0 text-mint" strokeWidth={1.9} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-mut">{body}</span>
      </span>
      {external ? <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--mut-2)]" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--mut-2)]" aria-hidden="true" />}
    </>
  );
  const className = 'glass-press flex min-h-16 items-center gap-3 px-4 py-3';
  if (external) return <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => haptic('light')} className={className}>{inner}</a>;
  return <Link href={href} onClick={() => haptic('light')} className={className}>{inner}</Link>;
}
