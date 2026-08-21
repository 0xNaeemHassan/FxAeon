'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Fuel,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  actionExecute,
  actionQuote,
  apiAvailable,
  ApiError,
  type ActionExecuteResult,
  type ActionQuote,
  type FeeTierKey,
  type MiniActionParams,
} from '@/lib/api';
import { getWebApp, haptic } from '@/lib/telegram';
import { Button, Card } from '@/components/ui';
import { BridgeTracker } from '@/components/BridgeTracker';
import { HealthGauge } from '@/components/HealthGauge';

function feeLabel(eth: number, usd: number | null): string {
  if (usd !== null) return `$${usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `${eth.toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH`;
}

export function ActionReview({
  params,
  label = 'Review action',
  disabled = false,
  onComplete,
}: {
  params: MiniActionParams | null;
  label?: string;
  disabled?: boolean;
  onComplete?: (result: ActionExecuteResult) => void;
}) {
  const [quote, setQuote] = useState<ActionQuote | null>(null);
  const [stage, setStage] = useState<'input' | 'quote' | 'executing' | 'result'>('input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [result, setResult] = useState<ActionExecuteResult | null>(null);
  const [feeTier, setFeeTier] = useState<FeeTierKey>('market');
  const [clockMs, setClockMs] = useState(() => Date.now());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (stage === 'quote') reviewHeadingRef.current?.focus({ preventScroll: true });
    if (stage === 'result') resultHeadingRef.current?.focus({ preventScroll: true });
  }, [stage]);

  useEffect(() => {
    if (stage !== 'quote' || !quote) return;
    setClockMs(Date.now());
    const timer = window.setInterval(() => setClockMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [quote, stage]);

  const returnFocusToTrigger = () => {
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const selectedTier = useMemo(
    () => quote?.gas.tiers.find((tier) => tier.key === feeTier) ?? quote?.gas.tiers[0],
    [feeTier, quote]
  );
  const remainingSeconds = quote
    ? Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - clockMs) / 1_000))
    : 0;
  const quoteExpired = Boolean(quote) && remainingSeconds <= 0;

  const review = useCallback(async () => {
    if (!params || disabled || loading) return;
    if (!apiAvailable()) {
      setError({ message: 'Open this screen from the authenticated Telegram menu to prepare live transactions.' });
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await actionQuote(params);
      setQuote(response.quote);
      setFeeTier(response.quote.gas.recommended);
      setStage('quote');
      haptic('selection');
    } catch (cause) {
      setError({
        code: cause instanceof ApiError ? cause.code : undefined,
        message: cause instanceof Error ? cause.message : 'A live quote could not be prepared.',
      });
      haptic('error');
    } finally {
      setLoading(false);
    }
  }, [disabled, loading, params]);

  const execute = useCallback(async () => {
    if (!quote || loading) return;
    if (quoteExpired) {
      setError({ code: 'QUOTE_TICKET_EXPIRED', message: 'This live review expired. Go back and prepare a fresh quote.' });
      return;
    }
    setLoading(true);
    setError(null);
    setStage('executing');
    try {
      const response = await actionExecute(quote.ticket, feeTier);
      setResult(response);
      setStage('result');
      onComplete?.(response);
      haptic(response.status === 'confirmed' ? 'success' : response.status === 'broadcast' ? 'warning' : 'error');
    } catch (cause) {
      setError({
        code: cause instanceof ApiError ? cause.code : undefined,
        message: cause instanceof Error ? cause.message : 'The transaction was not sent.',
      });
      setStage('quote');
      haptic('error');
    } finally {
      setLoading(false);
    }
  }, [feeTier, loading, onComplete, quote, quoteExpired]);

  if (stage === 'input') {
    return (
      <div className="flex flex-col gap-2.5">
        {error && <InlineError error={error} />}
        <Button ref={triggerRef} disabled={!params || disabled} loading={loading} onClick={() => void review()}>
          <Sparkles className="h-4 w-4" /> {label}
        </Button>
        <p className="px-1 text-center text-[10.5px] leading-relaxed text-mut">
          Nothing is signed yet. The server builds, simulates and freezes the exact route shown in this review.
        </p>
      </div>
    );
  }

  if (stage === 'result' && result) {
    const successful = result.status === 'confirmed';
    const failed = ['failed', 'reverted', 'partial', 'cancelled'].includes(result.status);
    const resultTitle = successful
      ? 'Confirmed on-chain'
      : result.status === 'partial'
        ? 'Route partially completed'
        : result.status === 'cancelled'
          ? 'Transaction cancelled'
          : result.status === 'reverted'
            ? 'Transaction reverted'
            : 'Transaction pending';
    const hashes = [...new Set(result.hashes.length > 0 ? result.hashes : result.txHash ? [result.txHash] : [])];
    const explorerName = result.chainId === 8453 ? 'BaseScan' : 'Etherscan';
    const openHash = (hash: string) => {
      const explorer = result.chainId === 8453 ? 'https://basescan.org' : 'https://etherscan.io';
      const url = `${explorer}/tx/${hash}`;
      const telegram = getWebApp();
      if (telegram?.openLink) telegram.openLink(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    };
    return (
      <Card glow className="anim-scale-in p-5">
        <div className="flex flex-col items-center text-center">
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
              successful
                ? 'bg-[var(--success-dim)] text-success'
                : failed
                  ? 'bg-[var(--danger-dim)] text-danger'
                  : 'bg-[var(--warn-dim)] text-warn'
            }`}
          >
            {successful
              ? <CheckCircle2 className="h-7 w-7" />
              : failed
                ? <AlertTriangle className="h-6 w-6" />
                : <RefreshCw className="h-6 w-6" />}
          </span>
          <h3 ref={resultHeadingRef} tabIndex={-1} className="text-display mt-4 text-[21px] font-semibold outline-none">
            {resultTitle}
          </h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-mut">
            {successful
              ? 'Your on-chain state is final. Portfolio data will refresh from the protocol.'
              : result.message ?? `Current status: ${result.status}. Track it from Activity.`}
          </p>
          {result.receipt && (
            <div className="mt-4 grid w-full grid-cols-2 gap-2 text-left">
              <ResultMetric label="Block" value={result.receipt.blockNumber.toLocaleString('en-US')} />
              <ResultMetric label="Confirmations" value={result.receipt.confirmations.toString()} />
              <ResultMetric label="Gas used" value={Number(result.receipt.gasUsed).toLocaleString('en-US')} />
              <ResultMetric
                label="Network fee"
                value={result.receipt.gasPaidUsd === null
                  ? `${result.receipt.gasPaidEth.toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH`
                  : `$${result.receipt.gasPaidUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
              />
            </div>
          )}
          {params?.kind === 'bridge' && (
            <div className="mt-4 w-full text-left">
              <BridgeTracker
                sourceChain={params.direction === 'ethereum_to_base' ? 'Ethereum' : 'Base'}
                destinationChain={params.direction === 'ethereum_to_base' ? 'Base' : 'Ethereum'}
                token={params.token}
                amount={params.amount}
                sourceTxHash={hashes[0]}
                status={successful ? 'delivered' : failed ? 'failed' : 'in_flight'}
              />
            </div>
          )}

          {hashes.length > 0 && params?.kind !== 'bridge' && (
            <div className="mt-4 flex w-full flex-col gap-2 text-left">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-mut">
                {hashes.length === 1 ? 'Transaction' : `${hashes.length} route transactions`}
              </p>
              {hashes.map((hash, index) => (
                <button
                  key={hash}
                  type="button"
                  className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-[var(--mint-dim)] px-3 text-[11.5px] font-semibold text-mint"
                  onClick={() => openHash(hash)}
                >
                  <span>Step {index + 1} · {hash.slice(0, 8)}…{hash.slice(-6)}</span>
                  <span className="inline-flex items-center gap-1">{explorerName} <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></span>
                </button>
              ))}
            </div>
          )}
          <Button
            variant="ghost"
            className="mt-4"
            onClick={() => {
              setStage('input');
              setQuote(null);
              setResult(null);
              setError(null);
              returnFocusToTrigger();
            }}
          >
            Done
          </Button>
        </div>
      </Card>
    );
  }

  if (!quote) return null;
  return (
    <Card glow className="anim-scale-in p-5">
      <button
        type="button"
        onClick={() => {
          if (loading) return;
          setStage('input');
          setQuote(null);
          setError(null);
          returnFocusToTrigger();
        }}
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl pr-3 text-[12px] font-semibold text-mut"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Edit
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-mint">Final review</p>
          <h3 ref={reviewHeadingRef} tabIndex={-1} className="text-display mt-1.5 text-[22px] font-semibold leading-tight outline-none">{quote.title}</h3>
          <p className="mt-1 text-[12px] text-mut">{quote.description}</p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
          <ShieldCheck className="h-5 w-5" />
        </span>
      </div>

      <div className="my-4 hairline" />
      <div className={`mb-4 flex min-h-11 items-center justify-between rounded-xl px-3 text-[11px] ${
        quoteExpired ? 'bg-[var(--danger-dim)] text-danger' : 'bg-[var(--mint-dim)] text-mint'
      }`}>
        <span className="font-semibold">Frozen server route</span>
        <span>{quoteExpired ? 'Expired — review again' : `Expires in ${remainingSeconds}s`}</span>
      </div>
      <div className="flex flex-col gap-3">
        {quote.details.map((detail) => (
          <div key={`${detail.label}-${detail.value}`} className="flex items-start justify-between gap-4 text-[12.5px]">
            <span className="text-mut">{detail.label}</span>
            <span className="max-w-[58%] text-right font-semibold">{detail.value}</span>
          </div>
        ))}
        <div className="flex items-start justify-between gap-4 text-[12.5px]">
          <span className="text-mut">Network</span>
          <span className="font-semibold">{quote.network}</span>
        </div>
        <div className="flex items-start justify-between gap-4 text-[12.5px]">
          <span className="text-mut">MEV protection</span>
          <span className={quote.mevProtection === 'on' ? 'font-semibold text-success' : 'font-semibold text-warn'}>
            {quote.chainId === 8453
              ? 'Base sequencer'
              : quote.mevProtection === 'on'
                ? 'Private'
                : 'Public mempool'}
          </span>
        </div>
      </div>

      {(params?.kind === 'position_open' || params?.kind === 'position_adjust') && params.leverage && (
        <div className="mt-4">
          <HealthGauge
            mode="leverage"
            value={params.leverage}
            side={params.side}
            market={params.market}
          />
        </div>
      )}

      {quote.warning && (
        <div className="mt-4 flex gap-2.5 rounded-2xl border border-[rgba(255,194,102,.18)] bg-[var(--warn-dim)] p-3 text-[11.5px] leading-relaxed text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {quote.warning}
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] p-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-mut">
          <Fuel className="h-3.5 w-3.5" /> Network speed
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Network speed">
          {quote.gas.tiers.map((tier, index) => (
            <button
              key={tier.key}
              type="button"
              role="radio"
              aria-checked={tier.key === feeTier}
              tabIndex={tier.key === feeTier ? 0 : -1}
              onClick={() => {
                setFeeTier(tier.key);
                haptic('selection');
              }}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
                const next = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? quote.gas.tiers.length - 1
                    : (index + (backwards ? -1 : 1) + quote.gas.tiers.length) % quote.gas.tiers.length;
                setFeeTier(quote.gas.tiers[next].key);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
                haptic('selection');
              }}
              className={`glass-press min-h-11 rounded-xl border px-2 py-2.5 text-center ${
                tier.key === feeTier
                  ? 'border-[rgba(139,109,255,.55)] bg-[var(--mint-dim)]'
                  : 'border-transparent bg-[rgba(255,255,255,.025)]'
              }`}
            >
              <span className="block text-[11.5px] font-semibold capitalize">{tier.key}</span>
              <span className="mt-0.5 block text-[9.5px] text-mut">{feeLabel(tier.estCostEth, tier.estCostUsd)}</span>
            </button>
          ))}
        </div>
        {selectedTier && (
          <p className="mt-2 text-center text-[10px] text-mut">
            Up to {selectedTier.maxFeeGwei.toFixed(2)} gwei · {Number(quote.gas.units).toLocaleString('en-US')} gas
          </p>
        )}
      </div>

      {error && <div className="mt-3"><InlineError error={error} /></div>}
      <Button disabled={quoteExpired} className="mt-4" loading={loading || stage === 'executing'} onClick={() => void execute()}>
        <ShieldCheck className="h-4 w-4" /> Confirm and execute
      </Button>
      <p className="mt-2 text-center text-[10px] leading-relaxed text-mut">
        Confirm uses your revocable delegated signer. The route is simulated again immediately before broadcast.
      </p>
    </Card>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[rgba(255,255,255,.035)] px-3 py-2.5">
      <span className="block text-[9px] uppercase tracking-[0.11em] text-mut">{label}</span>
      <span className="mt-1 block truncate text-[11.5px] font-semibold">{value}</span>
    </div>
  );
}

function InlineError({ error }: { error: { code?: string; message: string } }) {
  return (
    <div role="alert" className="flex gap-2.5 rounded-2xl border border-[rgba(255,107,118,.2)] bg-[var(--danger-dim)] p-3 text-[11.5px] leading-relaxed text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {error.message}
        {error.code === 'BOT_TRADING_OFF' && (
          <a href="/settings" className="ml-1 font-semibold underline underline-offset-2">Enable signer access</a>
        )}
      </span>
    </div>
  );
}
