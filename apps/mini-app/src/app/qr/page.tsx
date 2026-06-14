'use client';

/**
 * Deposit — the user's policy-wallet address as QR + copy. The address comes
 * from the bot (?address=... on bot-launched buttons) or is fetched live via
 * the authenticated API when opened from inside the app.
 */
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, AlertTriangle, PlugZap } from 'lucide-react';
import { isTMA, getInitData, haptic } from '@/lib/telegram';
import { apiConfigured, getMe } from '@/lib/api';
import { AppShell, Button, Card, EmptyState, FullScreenSpinner, Skeleton } from '@/components/ui';
import { useT } from '@/lib/i18n';

const TOKENS = ['ETH', 'wstETH', 'WBTC', 'fxUSD'];

function QRContent() {
  const t = useT();
  const searchParams = useSearchParams();
  const paramAddress = searchParams.get('address') || '';
  const [address, setAddress] = useState(paramAddress);
  const [loading, setLoading] = useState(!paramAddress);
  const [copied, setCopied] = useState(false);
  const [unavailable, setUnavailable] = useState('');

  useEffect(() => {
    if (paramAddress) return;
    if (!isTMA() || !getInitData() || !apiConfigured()) {
      setLoading(false);
      setUnavailable(t('deposit.noAddress'));
      return;
    }
    getMe()
      .then((me) => {
        if (me.onboarded && me.walletAddress) setAddress(me.walletAddress);
        else setUnavailable(t('deposit.noWallet'));
      })
      .catch((e: Error) => setUnavailable(e.message))
      .finally(() => setLoading(false));
  }, [paramAddress, t]);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      haptic('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <AppShell title={t('deposit.title')} subtitle={t('deposit.subtitle')}>
      <div className="stagger flex flex-col gap-3.5">
        {loading ? (
          <Skeleton className="h-72" />
        ) : address ? (
          <>
            <Card className="flex flex-col items-center gap-4 p-6">
              <div className="anim-scale-in rounded-2xl bg-white p-3.5">
                <QRCodeSVG value={address} size={208} level="M" />
              </div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {TOKENS.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-[var(--mint-dim)] px-2.5 py-1 text-[11px] font-medium text-mint"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </Card>

            <Card>
              <p className="text-[11px] uppercase tracking-wide text-mut">{t('deposit.address')}</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="break-all font-mono text-[12.5px] leading-relaxed">{address}</p>
                <button
                  type="button"
                  onClick={copy}
                  aria-label="Copy address"
                  className="glass glass-press shrink-0 rounded-xl p-2.5"
                >
                  {copied ? (
                    <Check className="h-4.5 w-4.5 h-[18px] w-[18px] text-success" />
                  ) : (
                    <Copy className="h-[18px] w-[18px] text-mut" />
                  )}
                </button>
              </div>
              <Button onClick={copy} variant="ghost" className="mt-3">
                {copied ? t('common.copied') : t('common.copyAddress')}
              </Button>
            </Card>

            <Card className="flex items-start gap-2.5 border-[rgba(255,194,75,0.3)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <p className="text-[12.5px] leading-relaxed text-mut">
                <span className="font-medium text-warn">{t('deposit.mainnetOnlyBold')}</span>{' '}
                {t('deposit.mainnetOnlyBody')}
              </p>
            </Card>
          </>
        ) : (
          <EmptyState icon={PlugZap} title={t('deposit.unavailableTitle')} body={unavailable} />
        )}
      </div>
    </AppShell>
  );
}

export default function QRPage() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <QRContent />
    </Suspense>
  );
}
