'use client';

/**
 * FxAeon shared UI kit — every screen composes these so the app feels like
 * one product instead of disconnected pages.
 */
import { forwardRef, ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  CandlestickChart,
  PiggyBank,
  ArrowLeftRight,
  LayoutGrid,
  Copy,
  Check,
  LucideIcon,
  ChevronRight,
} from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { useT } from '@/lib/i18n';
import FxLogo from '@/components/FxLogo';
import { HealthChip } from '@/components/HealthChip';

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
  const pathname = usePathname();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const target = headingRef.current ?? contentRef.current;
    target?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className={`app-shell mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-[430px] flex-col px-5 pt-[calc(env(safe-area-inset-top,0px)+1.25rem)] ${tabs ? 'pb-safe' : 'pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)]'}`}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {title && (
        <header className="page-header anim-fade-up mb-5">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-mint">
              <span className="status-dot" aria-hidden="true" /> FxAeon
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="text-display text-[27px] font-semibold leading-tight tracking-[-0.035em] outline-none">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[13px] leading-relaxed text-mut">{subtitle}</p>}
          </div>
        </header>
      )}
      <HealthChip />
      <main ref={contentRef} id="main-content" tabIndex={-1} className="flex-1 outline-none">{children}</main>
      {tabs && <TabBar />}
    </div>
  );
}

const TABS: { href: string; labelKey: string; icon: LucideIcon; also?: string[] }[] = [
  { href: '/portfolio', labelKey: 'nav.home', icon: Home },
  { href: '/trade', labelKey: 'nav.trade', icon: CandlestickChart, also: ['/positions', '/borrow'] },
  { href: '/earn', labelKey: 'nav.earn', icon: PiggyBank },
  { href: '/move', labelKey: 'nav.move', icon: ArrowLeftRight, also: ['/qr'] },
  { href: '/more', labelKey: 'nav.more', icon: LayoutGrid, also: ['/activity', '/settings'] },
];

export function TabBar() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40" aria-label="Primary navigation">
      <div className="tabbar-safe mx-auto w-full max-w-[430px] px-4 pb-3">
        <div className="tabbar pointer-events-auto flex items-center justify-between rounded-[24px] px-1.5 py-1.5">
          {TABS.map(({ href, labelKey, icon: Icon, also }) => {
            const active = pathname === href || Boolean(also?.some((prefix) => pathname.startsWith(prefix)));
            return (
              <Link
                key={href}
                href={href}
                onClick={() => haptic('selection')}
                aria-current={active ? 'page' : undefined}
                className={`nav-item flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-[16px] text-[9px] font-semibold ${
                  active ? 'nav-item-active text-mint' : 'text-mut'
                }`}
              >
                <span className="nav-icon relative flex h-6 w-8 items-center justify-center rounded-full">
                  <Icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={active ? 2.35 : 1.8} />
                </span>
                {t(labelKey)}
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
  elevation = 1,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  elevation?: 1 | 2 | 3;
}) {
  const elevationClass = elevation === 2 ? 'astryx-card-elevated' : elevation === 3 ? 'astryx-card-elevated shadow-2xl' : 'astryx-card';
  return (
    <div className={`${elevationClass} glass p-4 ${glow ? 'card-glow' : ''} ${className}`}>{children}</div>
  );
}

function buttonClasses(variant: 'primary' | 'ghost' | 'danger' | 'outline' | 'glass', className = ''): string {
  const styles =
    variant === 'primary'
      ? 'button-primary text-white font-semibold shadow-[0_4px_16px_rgba(139,109,255,0.35)]'
      : variant === 'danger'
        ? 'button-danger text-danger'
        : variant === 'outline'
          ? 'border border-[var(--astryx-border-default)] bg-[rgba(255,255,255,0.03)] text-[var(--text)] hover:border-[var(--astryx-border-strong)]'
          : variant === 'glass'
            ? 'astryx-card text-white hover:border-[var(--astryx-border-strong)]'
            : 'button-ghost text-[var(--text)]';
  return `button glass-press astryx-interactive flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[15px] disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`;
}

export const Button = forwardRef<HTMLButtonElement, {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'outline' | 'glass';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}>(function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  loading = false,
  className = '',
}, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={() => {
        haptic('medium');
        onClick?.();
      }}
      className={buttonClasses(variant, className)}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      )}
      {children}
    </button>
  );
});

export function ButtonLink({
  children,
  href,
  variant = 'primary',
  external = false,
  className = '',
}: {
  children: ReactNode;
  href: string;
  variant?: 'primary' | 'ghost' | 'danger' | 'outline' | 'glass';
  external?: boolean;
  className?: string;
}) {
  const props = external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  return (
    <a
      href={href}
      {...props}
      onClick={() => haptic('medium')}
      className={buttonClasses(variant, className)}
    >
      {children}
    </a>
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
    <div className="stat-card glass glass-press flex flex-col gap-1.5 p-4">
      <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-mut">{label}</span>
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
        <Icon aria-hidden="true" className="h-5 w-5 text-mint" strokeWidth={2} />
      </span>
      <span className="flex flex-col text-left">
        <span className="text-[14px] font-medium">{label}</span>
        {hint && <span className="text-[11px] text-mut">{hint}</span>}
      </span>
      <ChevronRight className="ml-auto h-4 w-4 text-[var(--mut-2)]" aria-hidden="true" />
    </>
  );
  const cls = 'action-tile glass glass-press flex min-h-16 w-full items-center gap-3 p-3.5';
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

export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(input);
    return copied;
  } catch {
    return false;
  }
}

export function AddressChip({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <button
      type="button"
      aria-label={copied ? 'Address copied' : `Copy wallet address ${short}`}
      title={address}
      onClick={async () => {
        if (await copyText(address)) {
          haptic('success');
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } else {
          haptic('error');
        }
      }}
      className="address-chip glass glass-press inline-flex min-h-11 items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[12px] text-mut"
    >
      {short}
      {copied ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy aria-hidden="true" className="h-3.5 w-3.5" />
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
    <div className="empty-state glass anim-scale-in flex flex-col items-center gap-2 px-6 py-9 text-center">
      <span className="empty-icon anim-float flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--mint-dim)]">
        <Icon aria-hidden="true" className="h-6 w-6 text-mint" strokeWidth={1.8} />
      </span>
      <p className="mt-1 text-[15px] font-medium">{title}</p>
      {body && <p className="text-[12.5px] leading-relaxed text-mut">{body}</p>}
      {action && <div className="mt-3 w-full">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 mt-7 flex items-center justify-between">
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mut">
        {children}
      </h2>
      {right}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function LoadingRegion({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function FullScreenSpinner() {
  const t = useT();
  // Contentful loading state: the brand text paints pre-hydration, so slow
  // cold starts show content instead of a blank screen. A border-only
  // spinner does NOT count as a contentful paint (Lighthouse NO_FCP).
  return (
    <div role="status" aria-live="polite" aria-label={t('common.loading')} className="flex min-h-[var(--tg-viewport-stable-height)] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="brand-orbit anim-scale-in">
        <FxLogo size={56} />
      </div>
      <div>
        <h1 className="text-display text-2xl font-semibold tracking-[-0.04em]">
          Fx<span className="text-gradient">Aeon</span>
        </h1>
        <p className="mt-1.5 text-[12.5px] text-mut">{t('common.loading')}</p>
      </div>
      <span className="loading-line" aria-hidden="true" />
    </div>
  );
}
