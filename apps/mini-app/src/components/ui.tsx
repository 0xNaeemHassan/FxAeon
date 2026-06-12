'use client';

/**
 * FxAeon shared UI kit — every screen composes these so the app feels like
 * one product instead of disconnected pages.
 */
import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  CandlestickChart,
  QrCode,
  Settings,
  Copy,
  Check,
  LucideIcon,
} from 'lucide-react';
import { haptic } from '@/lib/telegram';

/* ------------------------------------------------------------------ shell */

export function AppShell({
  title,
  subtitle,
  children,
  tabs = true,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  tabs?: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col px-5 pt-5 pb-safe">
      {title && (
        <header className="anim-fade-up mb-5">
          <h1 className="text-display text-[26px] font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] text-mut">{subtitle}</p>}
        </header>
      )}
      <div className="flex-1">{children}</div>
      {tabs && <TabBar />}
    </div>
  );
}

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/portfolio', label: 'Home', icon: Home },
  { href: '/trade', label: 'Trade', icon: CandlestickChart },
  { href: '/qr', label: 'Deposit', icon: QrCode },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40">
      <div className="tabbar-safe mx-auto w-full max-w-md px-5 pb-3">
        <div className="glass flex items-center justify-between rounded-3xl px-2 py-2"
          style={{ background: 'rgba(10,13,15,0.82)' }}
        >
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => haptic('selection')}
                className={`flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 text-[10px] font-medium transition-colors ${
                  active ? 'bg-[var(--mint-dim)] text-mint' : 'text-mut'
                }`}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.4 : 1.8} />
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ atoms */

export function Card({
  children,
  className = '',
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div className={`glass p-4 ${glow ? 'anim-glow' : ''} ${className}`}>{children}</div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  loading = false,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const styles =
    variant === 'primary'
      ? 'bg-mint text-[#06231a] font-semibold shadow-[0_8px_24px_rgba(46,230,168,0.25)]'
      : variant === 'danger'
        ? 'bg-[rgba(255,107,107,0.14)] text-danger border border-[rgba(255,107,107,0.3)]'
        : 'glass text-[var(--text)]';
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={() => {
        haptic('medium');
        onClick?.();
      }}
      className={`glass-press flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-[15px] transition-opacity disabled:opacity-40 ${styles} ${className}`}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="glass glass-press flex flex-col gap-1 p-4">
      <span className="text-[11px] uppercase tracking-wide text-mut">{label}</span>
      <span
        className={`text-display text-[20px] font-semibold leading-none ${accent ? 'text-gradient' : ''}`}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-mut">{sub}</span>}
    </div>
  );
}

export function ActionTile({
  icon: Icon,
  label,
  hint,
  href,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
        <Icon className="h-5 w-5 text-mint" strokeWidth={2} />
      </span>
      <span className="flex flex-col text-left">
        <span className="text-[14px] font-medium">{label}</span>
        {hint && <span className="text-[11px] text-mut">{hint}</span>}
      </span>
    </>
  );
  const cls = 'glass glass-press flex w-full items-center gap-3 p-3.5';
  if (href)
    return (
      <Link href={href} className={cls} onClick={() => haptic('light')}>
        {inner}
      </Link>
    );
  return (
    <button
      type="button"
      className={cls}
      onClick={() => {
        haptic('light');
        onClick?.();
      }}
    >
      {inner}
    </button>
  );
}

export function AddressChip({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          haptic('success');
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="glass glass-press inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[12px] text-mut"
    >
      {short}
      {copied ? (
        <Check className="h-3.5 w-3.5 text-mint" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="glass anim-scale-in flex flex-col items-center gap-2 px-6 py-8 text-center">
      <span className="anim-float flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--mint-dim)]">
        <Icon className="h-6 w-6 text-mint" strokeWidth={1.8} />
      </span>
      <p className="mt-1 text-[15px] font-medium">{title}</p>
      {body && <p className="text-[12.5px] leading-relaxed text-mut">{body}</p>}
      {action && <div className="mt-3 w-full">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 mt-6 flex items-center justify-between">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-mut">
        {children}
      </h2>
      {right}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function FullScreenSpinner() {
  // Contentful loading state: the brand text paints pre-hydration, so slow
  // cold starts show content instead of a blank screen. A border-only
  // spinner does NOT count as a contentful paint (Lighthouse NO_FCP).
  return (
    <div className="flex min-h-[var(--tg-viewport-stable-height)] flex-col items-center justify-center gap-3">
      <h1 className="text-display text-2xl font-semibold">
        Fx<span className="text-gradient">Aeon</span>
      </h1>
      <span
        className="h-7 w-7 animate-spin rounded-full border-[3px] border-mint border-t-transparent"
        aria-hidden="true"
      />
      <p className="text-[12.5px] text-mut">Loading f(x) Protocol trading…</p>
    </div>
  );
}
