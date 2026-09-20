'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Check, CheckCircle2, Circle, Clock3, Copy, ExternalLink, LoaderCircle, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { TransactionStepResult } from '@/lib/fx';
import { openExternalLink } from '@/lib/telegram';
import { transactionExplorerUrl, transactionStepKind, transactionStepProgress } from '@/lib/transactionProgress';

export function chainName(chainId: number): string {
  return chainId === 8453 ? 'Base' : chainId === 1 ? 'Ethereum' : `Chain ${chainId}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function stepProgress(step: TransactionStepResult | undefined): {
  label: string;
  className: string;
  icon: ReactNode;
} {
  const { state, label } = transactionStepProgress(step);
  if (state === 'confirmed') return { label, className: 'text-success', icon: <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> };
  if (state === 'unknown' || state === 'unverified') return { label, className: 'text-warn', icon: <Clock3 aria-hidden="true" className="h-3.5 w-3.5" /> };
  if (state === 'stopped' || state === 'reverted') return { label, className: 'text-danger', icon: <XCircle aria-hidden="true" className="h-3.5 w-3.5" /> };
  if (state === 'submitted' || state === 'included' || state === 'confirming') return { label, className: 'text-mint', icon: <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> };
  return { label, className: 'text-mut', icon: <Circle aria-hidden="true" className="h-3.5 w-3.5" /> };
}

export function TransactionHashLink({ step, chainId }: { step: TransactionStepResult; chainId: number }) {
  const url = transactionExplorerUrl(chainId, step.hash);
  if (!url || !step.hash) return null;
  const progress = stepProgress(step);
  const kind = transactionStepKind(step);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${kind} ${step.index + 1}: ${progress.label}. View transaction ${step.hash} on ${chainName(chainId)} explorer (opens in a new tab)`}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (openExternalLink(url)) event.preventDefault();
      }}
      className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-[var(--mint-dim)] px-3 py-2 text-[11.5px] font-semibold text-mint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mint)]"
    >
      <span className="min-w-0">
        <span className="block">{kind} {step.index + 1} · {shortHash(step.hash)}</span>
        <span className={`mt-1 inline-flex items-center gap-1 text-[10.5px] ${progress.className}`}>{progress.icon}{progress.label}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1">Explorer <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></span>
    </a>
  );
}

export function StatusNotice({ label, body, className, icon }: { label: string; body: string; className: string; icon: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="flex items-start gap-2.5 rounded-xl bg-[rgba(255,255,255,.035)] p-3 text-[11.5px] leading-relaxed">
      <span className={`mt-0.5 shrink-0 ${className}`}>{icon}</span>
      <span><span className={`font-semibold ${className}`}>{label}</span><span className="mt-0.5 block text-mut">{body}</span></span>
    </div>
  );
}

export function InlineError({ message }: { message: string }) {
  return <div role="alert" className="flex gap-2.5 rounded-lg border border-[rgba(255,107,118,.2)] bg-[var(--danger-dim)] p-3 text-[11.5px] leading-relaxed text-danger"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>;
}

export function CalldataDisclosure({ data }: { data: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mt-2 border-t border-[var(--line)] pt-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-mut">Calldata</span>
        <button type="button" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold text-mut hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--mint)]" onClick={() => void copy()}>
          {copied ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-28 overflow-auto rounded-lg bg-[rgba(0,0,0,.18)] p-2 font-mono text-[9px] leading-relaxed text-[var(--mut-2)] [overflow-wrap:anywhere]" tabIndex={0} aria-label="Transaction calldata">{data}</pre>
      <span role="status" className="sr-only">{copied ? 'Calldata copied' : ''}</span>
    </div>
  );
}
