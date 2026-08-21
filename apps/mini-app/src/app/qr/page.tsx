'use client';

/**
 * Deposit — the authenticated user's policy-wallet address as QR + copy.
 * Query-string addresses are deliberately ignored to prevent substitution.
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, AlertTriangle, PlugZap } from 'lucide-react';
import { isTMA, getInitData, haptic } from '@/lib/telegram';
import { apiConfigured, getMe } from '@/lib/api';
import { AppShell, Button, Card, copyText, EmptyState, FullScreenSpinner, LoadingRegion, Skeleton } from '@/components/ui';
import { useT } from '@/lib/i18n';

const TOKENS = ['ETH', 'WETH', 'stETH', 'wstETH', 'WBTC', 'USDC', 'USDT', 'fxUSD', 'fxSAVE'];

function QRContent() {
  const t = useT();
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [unavailable, setUnavailable] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setUnavailable('');
    setAddress('');
    // Never render a query-string address. Query parameters are attacker-
    // controlled and a crafted deep link could otherwise replace the user's
    // deposit destination. The authenticated API is the only authority.
    if (!isTMA() || !getInitData() || !apiConfigured()) {
      setLoading(false);
      setUnavailable(t('deposit.noAddress'));
      return;
    }
    try {
      const me = await getMe();
      if (me.onboarded && me.walletAddress) setAddress(me.walletAddress);
      else setUnavailable(t('deposit.noWallet'));
    } catch (cause) {
      setUnavailable(cause instanceof Error ? cause.message : t('deposit.noAddress'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const copy = async () => {
    if (!address) return;
    setCopyFailed(false);
    if (await copyText(address)) {
      haptic('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      haptic('error');
      setCopyFailed(true);
    }
  };

  return (
    <AppShell title={t('deposit.title')} subtitle={t('deposit.subtitle')}>
      <div className="stagger flex flex-col gap-3.5">
        {loading ? (
          <LoadingRegion label="Loading your deposit address"><Skeleton className="h-72" /></LoadingRegion>
        ) : address ? (
          <>
            <Card glow className="flex flex-col items-center gap-4 p-6">
              <div className="anim-scale-in rounded-[22px] bg-white p-3.5 shadow-[0_22px_50px_rgba(0,0,0,0.32)]">
                <QRCodeSVG value={address} size={208} level="M" title="Ethereum wallet deposit address" />
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
                  className="glass glass-press flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl p-2.5"
                >
                  {copied ? (
                    <Check className="h-[18px] w-[18px] text-success" />
                  ) : (
                    <Copy className="h-[18px] w-[18px] text-mut" />
                  )}
                </button>
              </div>
              <Button onClick={copy} variant="ghost" className="mt-3">
                {copied ? t('common.copied') : t('common.copyAddress')}
              </Button>
              <p className={`mt-2 min-h-4 text-center text-[11px] ${copyFailed ? 'text-danger' : 'text-mut'}`} aria-live="polite">
                {copyFailed ? 'Copy was blocked. Press and hold the address above to copy it manually.' : copied ? 'Address copied to clipboard.' : ''}
              </p>
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
          <EmptyState
            icon={PlugZap}
            title={t('deposit.unavailableTitle')}
            body={unavailable}
            action={isTMA() && getInitData() && apiConfigured()
              ? <Button onClick={() => void load()}>Retry</Button>
              : undefined}
          />
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
