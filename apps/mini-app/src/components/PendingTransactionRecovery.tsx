'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type { Address } from 'viem';
import { Button, Card, SectionTitle } from '@/components/ui';
import { BridgeTracker } from '@/components/BridgeTracker';
import { getPublicClient, reconcileWalletJournal, type RecoveryViewModel } from '@/lib/fx';
import { haptic } from '@/lib/telegram';

type Props = {
  walletAddress: Address;
  embedded?: boolean;
};

function chainName(chainId: RecoveryViewModel['record']['chainId']): string {
  return chainId === 8453 ? 'Base' : 'Ethereum';
}

function operationName(operation: string): string {
  return operation
    .replace(/^getFxSave/, 'fxSAVE ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (value) => value.toUpperCase());
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function submittedAt(timestamp: number): string {
  // UTC keeps the static/hydrated render deterministic and avoids implying
  // that a local timestamp is protocol state.
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'time unavailable';
  return date.toISOString().slice(0, 16).replace('T', ' UTC ');
}

function statusCopy(view: RecoveryViewModel): {
  label: string;
  icon: typeof Clock3;
  className: string;
} {
  if (view.status === 'confirmed') {
    return { label: 'Confirmed', icon: CheckCircle2, className: 'text-success' };
  }
  if (view.status === 'failed') {
    return { label: 'Reverted', icon: XCircle, className: 'text-danger' };
  }
  if (view.verification === 'rpc-error') {
    return { label: 'Check unavailable', icon: CircleAlert, className: 'text-warn' };
  }
  if (view.verification === 'mismatch') {
    return { label: 'Unverified', icon: CircleAlert, className: 'text-warn' };
  }
  return { label: 'Pending', icon: Clock3, className: 'text-mint' };
}

function statusSummary(view: RecoveryViewModel): string {
  if (view.status === 'confirmed' && view.record.bridge) return 'Confirmed on source. Destination delivery is tracked below.';
  if (view.status === 'confirmed') return 'Receipt and mined transaction verified on-chain.';
  if (view.status === 'failed') return 'The transaction reverted on-chain. No later step is resumed automatically.';
  if (view.verification === 'not-found') return 'No receipt yet. The transaction may still be pending.';
  if (view.verification === 'rpc-error') return 'The network could not be checked. Nothing was marked failed.';
  return 'The available chain data did not match the saved transaction details, so it remains unverified.';
}

function RecoveryItem({ view, trackBridge, autoTrackBridge }: { view: RecoveryViewModel; trackBridge: boolean; autoTrackBridge: boolean }) {
  const status = statusCopy(view);
  const Icon = status.icon;
  return (
    <li className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.025)] p-3">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] ${status.className}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[12.5px] font-semibold">{operationName(view.record.operation)}</p>
              <p className="mt-0.5 text-[10.5px] text-mut">{chainName(view.record.chainId)} · {submittedAt(view.record.submittedAt)}</p>
            </div>
            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] ${status.className}`}>{status.label}</span>
          </div>
          <p className="mt-2 break-words text-[11.5px] leading-relaxed text-mut">{statusSummary(view)}</p>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-[var(--mut-2)]">{shortHash(view.record.hash)}</span>
            <a
              href={view.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[10.5px] font-semibold text-mint hover:bg-[var(--mint-dim)]"
            >
              Explorer <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
          <details className="mt-1 border-t border-[var(--line)] pt-1">
            <summary className="flex min-h-11 cursor-pointer items-center text-[11px] font-semibold text-mut">Recovery details</summary>
            <div className="pb-2 text-[10.5px] leading-relaxed text-mut">
              <p>{view.message}</p>
              {view.receiptBlockNumber !== undefined && <p className="mt-1">Block {view.receiptBlockNumber.toString()}</p>}
              <p className="mt-1 font-mono text-[10px] text-[var(--mut-2)]">{view.record.hash}</p>
            </div>
          </details>
          {trackBridge && view.record.bridge && view.status === 'confirmed' && (
            <BridgeTracker
              className="mt-3"
              sourceChain={view.record.chainId === 1 ? 'Ethereum' : 'Base'}
              destinationChain={view.record.bridge.destinationChainId === 1 ? 'Ethereum' : 'Base'}
              token={view.record.bridge.bridgeToken ?? 'Bridge asset'}
              amount={formatBridgeAmount(view.record.bridge.amountLD)}
              sourceTxHash={view.record.hash}
              status="source_confirmed"
              sourceOftAddress={view.record.bridge.sourceOftAddress}
              destinationOftAddress={view.record.bridge.destinationOftAddress}
              recipient={view.record.bridge.recipient}
              sourceSender={view.record.walletAddress}
              amountLD={BigInt(view.record.bridge.amountLD)}
              minAmountLD={BigInt(view.record.bridge.minAmountLD)}
              destinationBaselineBlock={BigInt(view.record.bridge.destinationBaselineBlock)}
              autoStart={autoTrackBridge}
            />
          )}
        </div>
      </div>
    </li>
  );
}

function formatBridgeAmount(value: string): string {
  const whole = value.padStart(19, '0');
  const integer = whole.slice(0, -18).replace(/^0+(?=\d)/, '');
  const fraction = whole.slice(-18).replace(/0+$/, '').slice(0, 6);
  return fraction ? `${integer}.${fraction}` : integer;
}

/**
 * A read-only recovery surface for wallet-submitted hashes. This component
 * never resumes a route: a confirmed prerequisite only tells the user to
 * open the original flow and plan it again from fresh chain state.
 */
export default function PendingTransactionRecovery({ walletAddress, embedded = false }: Props) {
  const [views, setViews] = useState<RecoveryViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await reconcileWalletJournal({
        walletAddress,
        getClient: getPublicClient,
      });
      setViews([...next].reverse());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  const autoBridgeIds = useMemo(() => new Set(
    views
      .filter((view) => view.status === 'confirmed' && Boolean(view.record.bridge))
      .slice(0, 2)
      .map((view) => view.record.id),
  ), [views]);
  return (
    <section aria-labelledby="transaction-recovery-title">
      {!embedded && <SectionTitle
        right={(
          <button
            type="button"
            aria-label="Refresh transaction recovery"
            className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut hover:text-mint"
            onClick={() => {
              haptic('light');
              void refresh();
            }}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        )}
      >
        <span id="transaction-recovery-title">Activity</span>
      </SectionTitle>}
      {embedded && <h2 id="transaction-recovery-title" className="sr-only">Activity</h2>}
      <Card className="p-3.5">
        {loading ? (
          <div role="status" className="flex items-center gap-2 px-1 py-3 text-[11px] text-mut">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-mint border-t-transparent" aria-hidden="true" />
            Checking saved transactions…
          </div>
        ) : views.length === 0 ? (
          <p className="px-1 py-2 text-[12px] leading-relaxed text-mut">No submitted transactions need checking for this wallet.</p>
        ) : (
          <ul className="flex flex-col gap-2.5" aria-live="polite">
            {views.map((view) => (
              <RecoveryItem
                key={view.record.id}
                view={view}
                // Every independently confirmed bridge needs its own delivery
                // correlation. Tracking only the first bridge would leave
                // later transfers permanently unverified in the recovery UI.
                trackBridge={view.status === 'confirmed' && Boolean(view.record.bridge)}
                autoTrackBridge={autoBridgeIds.has(view.record.id)}
              />
            ))}
          </ul>
        )}
        {!loading && views.length > 0 && (
          <p className="mt-3 px-1 text-[11px] leading-relaxed text-mut">Checking is read-only. A saved transaction is never resent, and later steps are never resumed automatically.</p>
        )}
        <Button
          variant="ghost"
          className="mt-2 min-h-11 text-[11px]"
          loading={refreshing}
          onClick={() => void refresh()}
        >
          Check status again
        </Button>
      </Card>
    </section>
  );
}
