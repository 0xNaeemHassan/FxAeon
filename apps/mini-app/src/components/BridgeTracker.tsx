'use client';

import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  Layers,
  Network,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { getWebApp, haptic } from '@/lib/telegram';

export type BridgeStepStatus = 'completed' | 'in_progress' | 'pending' | 'failed';

export interface BridgeTrackerProps {
  sourceChain: 'Ethereum' | 'Base';
  destinationChain: 'Ethereum' | 'Base';
  token: string;
  amount: string;
  sourceTxHash?: string | null;
  status?: 'building' | 'broadcasting' | 'in_flight' | 'delivered' | 'failed';
  className?: string;
}

export function BridgeTracker({
  sourceChain,
  destinationChain,
  token,
  amount,
  sourceTxHash,
  status = 'in_flight',
  className = '',
}: BridgeTrackerProps) {
  const isSourceDone = ['in_flight', 'delivered'].includes(status) || Boolean(sourceTxHash);
  const isRelayerActive = status === 'in_flight';
  const isDelivered = status === 'delivered';

  const openExplorer = (url: string) => {
    haptic('light');
    const telegram = getWebApp();
    if (telegram?.openLink) telegram.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const sourceExplorer = sourceChain === 'Base' ? 'https://basescan.org' : 'https://etherscan.io';
  const layerzeroScanUrl = sourceTxHash ? `https://layerzeroscan.com/tx/${sourceTxHash}` : null;

  return (
    <div className={`flex flex-col rounded-2xl border border-[var(--line-strong)] bg-[rgba(18,18,29,0.7)] p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
            <Network className="h-4 w-4" />
          </span>
          <div>
            <h4 className="text-[13px] font-semibold">LayerZero V2 Route Tracker</h4>
            <p className="text-[10px] text-mut">{amount} {token} · {sourceChain} → {destinationChain}</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold ${
            isDelivered
              ? 'bg-[var(--success-dim)] text-success'
              : status === 'failed'
                ? 'bg-[var(--danger-dim)] text-danger'
                : 'bg-[var(--mint-dim)] text-mint'
          }`}
        >
          {isDelivered ? 'Delivered' : status === 'failed' ? 'Failed' : 'In Flight'}
        </span>
      </div>

      {/* 3-Step Timeline */}
      <div className="mt-4 flex flex-col gap-3 relative">
        {/* Step 1: Source */}
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full ${
                isSourceDone ? 'bg-success/20 text-success' : 'bg-[var(--mint-dim)] text-mint'
              }`}
            >
              {isSourceDone ? <CheckCircle2 className="h-4 w-4" /> : <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
            </span>
            <span className="my-1 h-6 w-0.5 bg-[var(--line)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold">{sourceChain} OFT Lock/Burn</span>
              {sourceTxHash && (
                <button
                  type="button"
                  onClick={() => openExplorer(`${sourceExplorer}/tx/${sourceTxHash}`)}
                  className="inline-flex items-center gap-1 font-mono text-[10px] text-mint hover:underline"
                >
                  {sourceTxHash.slice(0, 6)}…{sourceTxHash.slice(-4)} <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
            <p className="text-[10.5px] text-mut">
              {isSourceDone ? 'Transaction confirmed on source chain.' : 'Broadcasting transaction to network.'}
            </p>
          </div>
        </div>

        {/* Step 2: LayerZero Verification */}
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full ${
                isDelivered
                  ? 'bg-success/20 text-success'
                  : isRelayerActive
                    ? 'bg-[var(--mint-dim)] text-mint ring-2 ring-mint/40 anim-float'
                    : 'bg-[rgba(255,255,255,0.05)] text-mut'
              }`}
            >
              {isDelivered ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : isRelayerActive ? (
                <Layers className="h-3.5 w-3.5 text-mint" />
              ) : (
                <Clock3 className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="my-1 h-6 w-0.5 bg-[var(--line)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold">DVN & Relayer Attestation</span>
              {layerzeroScanUrl && (
                <button
                  type="button"
                  onClick={() => openExplorer(layerzeroScanUrl)}
                  className="inline-flex items-center gap-1 text-[10px] text-mint hover:underline"
                >
                  LayerZero Scan <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
            <p className="text-[10.5px] text-mut">
              {isDelivered
                ? 'Cross-chain packet verified and relayed.'
                : isRelayerActive
                  ? 'Decentralized Verifier Network confirming packet.'
                  : 'Awaiting source confirmation.'}
            </p>
          </div>
        </div>

        {/* Step 3: Destination */}
        <div className="flex items-start gap-3">
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full ${
              isDelivered
                ? 'bg-success/20 text-success'
                : 'bg-[rgba(255,255,255,0.05)] text-mut'
            }`}
          >
            {isDelivered ? <CheckCircle2 className="h-4 w-4" /> : <Sparkles className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-[12px] font-semibold">{destinationChain} Receipt & Unlock</span>
            <p className="text-[10.5px] text-mut">
              {isDelivered
                ? `Credited ${amount} ${token} to recipient wallet.`
                : 'Funds unlock automatically upon relayer delivery.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
