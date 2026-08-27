'use client';

import { useEffect, useRef, useState } from 'react';
import { getEidByChainId } from '@aladdindao/fx-sdk';
import { type Address, type Hex } from 'viem';
import { CheckCircle2, Clock3, ExternalLink, Network, Radio, RefreshCw, XCircle } from 'lucide-react';
import { assertPublicClientChain, getPublicClient } from '@/lib/fx';
import { userSafeError } from '@/lib/errors';
import {
  findSourceOftSent,
  findDestinationOftReceived,
  OFT_RECEIVED_EVENT,
  scanDestinationOftReceivedInChunks,
  type BridgeEventLog,
  type SourceOftSentMatch,
} from '@/lib/fx/bridgeDelivery';
import { getWebApp, haptic } from '@/lib/telegram';

export type BridgeStepStatus = 'pending' | 'source_confirmed' | 'destination_verified' | 'failed';

export interface BridgeTrackerProps {
  sourceChain: 'Ethereum' | 'Base';
  destinationChain: 'Ethereum' | 'Base';
  token: string;
  amount: string;
  sourceTxHash?: string | null;
  /** A source receipt is not proof of LayerZero delivery. */
  status?: BridgeStepStatus;
  /** Immutable bridge facts captured in the reviewed route. */
  sourceOftAddress?: string;
  destinationOftAddress?: string;
  recipient?: string;
  sourceSender?: string;
  amountLD?: bigint;
  minAmountLD?: bigint;
  destinationBaselineBlock?: bigint;
  /** Recovery lists auto-start only a bounded number of expensive log scans. */
  autoStart?: boolean;
  className?: string;
}

type GetLogsRequest = {
  address: Address;
  event: typeof OFT_RECEIVED_EVENT;
  args: { guid: Hex; toAddress: Address };
  fromBlock: bigint;
  toBlock: bigint;
};

type GetLogs = (request: GetLogsRequest) => Promise<readonly BridgeEventLog[]>;
const DESTINATION_CONFIRMATIONS = 3n;

function explorerFor(chain: 'Ethereum' | 'Base'): string {
  return chain === 'Base' ? 'https://basescan.org' : 'https://etherscan.io';
}

function openLink(url: string): void {
  haptic('light');
  const telegram = getWebApp();
  if (telegram?.openLink) telegram.openLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

function chainIdFor(chain: 'Ethereum' | 'Base'): 1 | 8453 {
  return chain === 'Base' ? 8453 : 1;
}

/**
 * Show bridge progress without ever treating a balance increase as delivery.
 * The only successful terminal state is a matching LayerZero V2
 * OFTSent(guid, ...) -> OFTReceived(guid, ...) pair.
 */
export function BridgeTracker({
  sourceChain,
  destinationChain,
  token,
  amount,
  sourceTxHash,
  status = 'pending',
  sourceOftAddress,
  destinationOftAddress,
  recipient,
  sourceSender,
  amountLD,
  minAmountLD,
  destinationBaselineBlock,
  autoStart = true,
  className = '',
}: BridgeTrackerProps) {
  const [verifiedContextKey, setVerifiedContextKey] = useState<string | null>(null);
  const [sourceEventFound, setSourceEventFound] = useState(false);
  const [detectedDestinationTxHash, setDetectedDestinationTxHash] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [retrySequence, setRetrySequence] = useState(0);
  const [manualStarted, setManualStarted] = useState(false);
  const destinationCursorRef = useRef<bigint | null>(null);
  const verificationContextKey = [
    status,
    sourceTxHash ?? '',
    sourceChain,
    destinationChain,
    sourceOftAddress ?? '',
    destinationOftAddress ?? '',
    recipient ?? '',
    sourceSender ?? '',
    amountLD?.toString() ?? '',
    minAmountLD?.toString() ?? '',
    destinationBaselineBlock?.toString() ?? '',
  ].join('|').toLowerCase();
  const sourceStatusConfirmed = status === 'source_confirmed' || status === 'destination_verified';
  const hasVerificationContext = Boolean(
    sourceTxHash && sourceOftAddress && destinationOftAddress && recipient && sourceSender
      && amountLD !== undefined && minAmountLD !== undefined && destinationBaselineBlock !== undefined,
  );

  useEffect(() => {
    setVerifiedContextKey(null);
    setSourceEventFound(false);
    setDetectedDestinationTxHash(null);
    setVerificationError(null);
    setCanRetry(false);
    setRetrySequence(0);
    setManualStarted(false);
    destinationCursorRef.current = null;
  }, [verificationContextKey]);

  useEffect(() => {
    if (!sourceStatusConfirmed || !sourceTxHash || (!autoStart && !manualStarted)) return;
    if (!sourceOftAddress || !destinationOftAddress || !recipient || !sourceSender || amountLD === undefined || minAmountLD === undefined || destinationBaselineBlock === undefined) {
      setVerificationError('Bridge verification context is incomplete. Delivery will not be marked from a source hash alone.');
      return;
    }

    let cancelled = false;
    setCanRetry(false);
    const sourceChainId = chainIdFor(sourceChain);
    const destinationChainId = chainIdFor(destinationChain);
    const maxAttempts = 24;
    const pollMs = 15_000;
    let attempts = 0;
    let sourceMessage: SourceOftSentMatch | undefined;
    // Advance this cursor between polls. Recovered bridges can be days old,
    // and a single baseline-to-head eth_getLogs request exceeds common RPC
    // range limits even though the matching delivery is valid.
    let nextDestinationBlock = destinationCursorRef.current ?? destinationBaselineBlock;

    const verify = async () => {
      try {
        const sourceClient = getPublicClient(sourceChainId);
        await assertPublicClientChain(sourceClient, sourceChainId);
        if (!sourceMessage) {
          const receipt = await sourceClient.getTransactionReceipt({ hash: sourceTxHash as Hex });
          if (receipt.transactionHash.toLowerCase() !== sourceTxHash.toLowerCase()) {
            throw new Error('source bridge receipt hash does not match the submitted transaction');
          }
          if (typeof receipt.blockNumber !== 'bigint' || receipt.blockNumber < 0n) {
            throw new Error('source bridge receipt has no canonical block number');
          }
          if (receipt.status !== 'success') throw new Error('source bridge receipt is not successful');
          sourceMessage = findSourceOftSent(receipt.logs as unknown as readonly BridgeEventLog[], {
            sourceOftAddress: sourceOftAddress as Address,
            destinationEid: getEidByChainId(destinationChainId),
            sender: sourceSender as Address,
            amountLD,
            minimumReceivedLD: minAmountLD,
          });
          if (!cancelled) setSourceEventFound(true);
        }

        const destinationClient = getPublicClient(destinationChainId);
        await assertPublicClientChain(destinationClient, destinationChainId);
        const latestBlock = await destinationClient.getBlockNumber();
        if (latestBlock < destinationBaselineBlock) {
          throw new Error('destination chain head is behind the reviewed baseline block');
        }
        const getLogs = destinationClient.getLogs as unknown as GetLogs;
        const scan = await scanDestinationOftReceivedInChunks({
          fromBlock: nextDestinationBlock,
          toBlock: latestBlock,
          getLogs: ({ fromBlock, toBlock }) => getLogs({
            address: destinationOftAddress as Address,
            event: OFT_RECEIVED_EVENT,
            args: {
              guid: sourceMessage!.guid,
              toAddress: recipient as Address,
            },
            fromBlock,
            toBlock,
          }),
          expected: {
            destinationOftAddress: destinationOftAddress as Address,
            guid: sourceMessage.guid,
            sourceEid: getEidByChainId(sourceChainId),
            recipient: recipient as Address,
            amountReceivedLD: sourceMessage.amountReceivedLD,
          },
        });
        nextDestinationBlock = scan.nextBlock;
        destinationCursorRef.current = scan.nextBlock;
        if (!scan.match) {
          throw new Error(scan.complete
            ? 'destination chain has not emitted the matching OFTReceived event'
            : `Scanning historical destination blocks through ${scan.nextBlock - 1n}.`);
        }
        const received = scan.match;
        if (typeof received.blockNumber !== 'bigint' || received.blockNumber < destinationBaselineBlock) {
          throw new Error('destination OFTReceived event has no canonical reviewed block number');
        }
        if (typeof received.blockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(received.blockHash)) {
          throw new Error('destination OFTReceived event has no canonical block hash');
        }
        if (typeof received.transactionHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(received.transactionHash)) {
          throw new Error('destination OFTReceived event has no canonical transaction hash');
        }
        // Keep rescanning the candidate block until it is deep enough. If a
        // reorg removes or replaces the event, the exact-block proof below
        // fails and destination verification is revoked rather than cached.
        nextDestinationBlock = received.blockNumber;
        destinationCursorRef.current = received.blockNumber;
        if (latestBlock < received.blockNumber + DESTINATION_CONFIRMATIONS - 1n) {
          if (!cancelled) setDetectedDestinationTxHash(received.transactionHash ?? null);
          throw new Error(`Delivery observed in block ${received.blockNumber}; waiting for ${DESTINATION_CONFIRMATIONS.toString()} destination confirmations.`);
        }
        const canonical = findDestinationOftReceived(await getLogs({
          address: destinationOftAddress as Address,
          event: OFT_RECEIVED_EVENT,
          args: {
            guid: sourceMessage.guid,
            toAddress: recipient as Address,
          },
          fromBlock: received.blockNumber,
          toBlock: received.blockNumber,
        }), {
          destinationOftAddress: destinationOftAddress as Address,
          guid: sourceMessage.guid,
          sourceEid: getEidByChainId(sourceChainId),
          recipient: recipient as Address,
          amountReceivedLD: sourceMessage.amountReceivedLD,
        });
        if (canonical.blockHash?.toLowerCase() !== received.blockHash.toLowerCase()
          || canonical.transactionHash?.toLowerCase() !== received.transactionHash.toLowerCase()) {
          throw new Error('destination delivery event changed during confirmation; checking the canonical chain again');
        }
        if (!cancelled) {
          setDetectedDestinationTxHash(received.transactionHash ?? null);
          setVerifiedContextKey(verificationContextKey);
          setVerificationError(null);
        }
        return;
      } catch (cause) {
        if (!cancelled) setVerificationError(userSafeError(cause, 'LayerZero delivery is not confirmed yet. Check again shortly.'));
      }
      attempts += 1;
      if (!cancelled && attempts < maxAttempts) window.setTimeout(verify, pollMs);
      else if (!cancelled) setCanRetry(true);
    };

    void verify();
    return () => {
      cancelled = true;
    };
  }, [amountLD, autoStart, destinationBaselineBlock, destinationChain, destinationOftAddress, manualStarted, minAmountLD, recipient, retrySequence, sourceChain, sourceOftAddress, sourceSender, sourceStatusConfirmed, sourceTxHash, verificationContextKey]);

  // Never trust an externally supplied destination_verified flag without the
  // local GUID/event correlation above.
  const verified = sourceStatusConfirmed && hasVerificationContext && verifiedContextKey === verificationContextKey;
  const effectiveStatus: BridgeStepStatus = verified ? 'destination_verified' : status === 'destination_verified' ? 'source_confirmed' : status;
  const sourceDone = Boolean(sourceTxHash) && effectiveStatus !== 'pending' && effectiveStatus !== 'failed';
  const delivered = effectiveStatus === 'destination_verified';
  const failed = effectiveStatus === 'failed';
  const sourceExplorer = sourceTxHash ? `${explorerFor(sourceChain)}/tx/${sourceTxHash}` : null;
  const destinationExplorer = detectedDestinationTxHash ? `${explorerFor(destinationChain)}/tx/${detectedDestinationTxHash}` : null;
  const layerzeroScan = sourceTxHash ? `https://layerzeroscan.com/tx/${sourceTxHash}` : null;

  return (
    <section aria-label="Bridge status" aria-live="polite" aria-atomic="false" className={`flex flex-col rounded-2xl border border-[var(--line-strong)] bg-[rgba(18,18,29,0.7)] p-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Network aria-hidden="true" className="h-4 w-4" /></span>
          <div>
            <h4 className="text-[13px] font-semibold">Bridge delivery</h4>
            <p className="text-[10px] text-mut">{amount ? `${amount} ${token} · ` : ''}{sourceChain} → {destinationChain}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold ${delivered ? 'bg-[var(--success-dim)] text-success' : failed ? 'bg-[var(--danger-dim)] text-danger' : 'bg-[var(--mint-dim)] text-mint'}`}>
          {delivered ? 'Verified' : failed ? 'Failed' : sourceDone ? 'Source confirmed' : 'Pending'}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <TimelineRow
          state={failed ? 'failed' : sourceDone ? 'done' : 'active'}
          title={`${sourceChain} transaction`}
          body={failed ? 'The source transaction did not complete.' : sourceDone ? sourceEventFound ? 'Receipt confirmed and the reviewed OFTSent event was found.' : 'Receipt confirmed; checking for the reviewed OFTSent event.' : 'Waiting for the source transaction receipt.'}
          action={sourceExplorer ? { label: 'Explorer', onClick: () => openLink(sourceExplorer) } : undefined}
        />
        <TimelineRow
          state={delivered ? 'done' : sourceDone ? 'active' : 'pending'}
          title="LayerZero delivery"
          body={delivered ? `The matching OFTReceived event remained canonical for ${DESTINATION_CONFIRMATIONS.toString()} destination confirmations.` : sourceDone ? verificationError ?? 'FxAeon is correlating the source OFTSent GUID with the destination OFTReceived event.' : 'Starts only after the source transaction is confirmed.'}
          action={layerzeroScan ? { label: 'LayerZero Scan', onClick: () => openLink(layerzeroScan) } : undefined}
        />
        <TimelineRow
          state={delivered ? 'done' : 'pending'}
          title={`${destinationChain} OFTReceived`}
          body={delivered ? `Destination delivery was verified from the canonical LayerZero V2 event after ${DESTINATION_CONFIRMATIONS.toString()} confirmations.` : 'Not verified yet. A balance increase or source hash can never claim delivery.'}
          action={destinationExplorer ? { label: 'Explorer', onClick: () => openLink(destinationExplorer) } : undefined}
        />
      </div>
      {sourceDone && !delivered && !failed && (canRetry || (!autoStart && !manualStarted)) && (
        <button
          type="button"
          onClick={() => {
            haptic('light');
            setVerificationError('Checking the destination chain again…');
            setCanRetry(false);
            setManualStarted(true);
            setRetrySequence((value) => value + 1);
          }}
          className="button glass-press mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-[11px] font-semibold text-mint"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {manualStarted || canRetry ? 'Check delivery again' : 'Check delivery'}
        </button>
      )}
    </section>
  );
}

function TimelineRow({
  state,
  title,
  body,
  action,
}: {
  state: 'done' | 'active' | 'pending' | 'failed';
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  const icon = state === 'done'
    ? <CheckCircle2 className="h-4 w-4" />
    : state === 'failed'
      ? <XCircle className="h-4 w-4" />
      : state === 'active'
        ? <Radio className="h-3.5 w-3.5 animate-pulse" />
        : <Clock3 className="h-3.5 w-3.5" />;
  const tone = state === 'done' ? 'bg-[var(--success-dim)] text-success' : state === 'failed' ? 'bg-[var(--danger-dim)] text-danger' : state === 'active' ? 'bg-[var(--mint-dim)] text-mint' : 'bg-[rgba(255,255,255,.05)] text-mut';
  return (
    <div className="flex items-start gap-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold">{title}</span>
          {action && <button type="button" onClick={action.onClick} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[10px] text-mint hover:bg-[var(--mint-dim)] hover:underline">{action.label} <ExternalLink aria-hidden="true" className="h-3 w-3" /></button>}
        </div>
        <p className="text-[10.5px] leading-relaxed text-mut">{body}</p>
      </div>
    </div>
  );
}
