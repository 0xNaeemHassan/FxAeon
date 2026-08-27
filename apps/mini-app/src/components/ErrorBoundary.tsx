'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, MessageCircle, RefreshCw, RotateCcw } from 'lucide-react';
import FxLogo from '@/components/FxLogo';
import { haptic } from '@/lib/telegram';

const TELEGRAM_APP_URL = process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || 'https://t.me/FxAeonBot/app';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isRetrying: boolean;
}

class ErrorBoundaryInner extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    isRetrying: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, errorInfo: null, isRetrying: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Do not write raw RPC errors, calldata, wallet context, or provider URLs
    // to production logs. Development details stay in the local fallback UI
    // only, where they are never transmitted by FxAeon.
    this.setState({ error, errorInfo });
    haptic('error');
  }

  private handleRetry = () => {
    haptic('warning');
    this.setState({ isRetrying: true });
    setTimeout(() => {
      this.setState({ hasError: false, error: null, errorInfo: null, isRetrying: false });
    }, 450);
  };

  private handleReload = () => {
    haptic('medium');
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <ErrorFallback
            error={this.state.error}
            errorInfo={this.state.errorInfo}
            isRetrying={this.state.isRetrying}
            onRetry={this.handleRetry}
            onReload={this.handleReload}
          />
        )
      );
    }
    return this.props.children;
  }
}

function ErrorFallback({
  error,
  errorInfo,
  isRetrying,
  onRetry,
  onReload,
}: {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isRetrying: boolean;
  onRetry: () => void;
  onReload: () => void;
}) {
  const showTechnicalDetails = process.env.NODE_ENV !== 'production';
  return (
    <main className="app-shell mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-[430px] items-center px-5 py-10">
      <section className="glass anim-scale-in w-full rounded-[28px] p-6 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[26px] border border-[rgba(255,107,118,0.22)] bg-[var(--danger-dim)]">
          <AlertTriangle className="h-9 w-9 text-danger" strokeWidth={1.7} aria-hidden="true" />
        </div>

        <div className="mt-5 flex items-center justify-center gap-2">
          <FxLogo size={22} />
          <span className="text-display text-[13px] font-semibold tracking-tight">FxAeon</span>
        </div>
        <h1 className="text-display mt-4 text-[23px] font-semibold tracking-[-0.035em]">
          This screen hit a snag
        </h1>
        <p className="mx-auto mt-2 max-w-[300px] text-[13px] leading-relaxed text-mut">
          The screen stopped unexpectedly. If you approved a transaction, verify its status in your wallet or chain explorer before retrying. Otherwise, retry or reload the Mini App.
        </p>

        {showTechnicalDetails && error && (
          <details className="mt-5 rounded-2xl border border-[var(--line)] bg-[rgba(0,0,0,0.18)] p-3 text-left">
            <summary className="cursor-pointer text-[12px] text-mut transition-colors hover:text-[var(--text)]">
              Technical details
            </summary>
            <div className="mt-2 max-h-36 overflow-auto rounded-xl bg-black/20 p-3 font-mono text-[10px] leading-relaxed text-mut">
              <p className="mb-1 font-semibold text-danger">{error.message}</p>
              {errorInfo?.componentStack && (
                <pre className="whitespace-pre-wrap">{errorInfo.componentStack}</pre>
              )}
            </div>
          </details>
        )}

        <div className="mt-6 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            aria-busy={isRetrying || undefined}
            className="button button-primary glass-press flex min-h-12 items-center justify-center gap-2 rounded-2xl px-3 text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {isRetrying ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Retrying…</span>
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Try again</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onReload}
            className="button button-ghost glass-press flex min-h-12 items-center justify-center gap-2 rounded-2xl px-3 text-[14px] font-medium"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>Reload</span>
          </button>
        </div>

        <p className="mt-5 text-[12px] text-mut">
          <a
            href={TELEGRAM_APP_URL}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-mint hover:bg-[var(--mint-dim)] hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> Reopen FxAeon in Telegram
          </a>
        </p>
      </section>
    </main>
  );
}

export default function ErrorBoundary({ children, fallback }: Props) {
  return (
    <ErrorBoundaryInner fallback={fallback}>
      {children}
    </ErrorBoundaryInner>
  );
}
