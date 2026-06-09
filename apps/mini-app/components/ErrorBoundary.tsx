'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { useTheme } from './ThemeProvider';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
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

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, isRetrying: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('FxAeon ErrorBoundary caught:', error, errorInfo);
    this.setState({ errorInfo });
    
    // Report to error tracking
    this.props.onError?.(error, errorInfo);
    
    // Show Telegram alert if available
    const tg = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : null;
    if (tg) {
      tg.HapticFeedback?.notificationOccurred?.('error');
    }
  }

  private handleRetry = () => {
    this.setState({ isRetrying: true });
    
    // Give visual feedback before resetting
    setTimeout(() => {
      this.setState({ hasError: false, error: null, errorInfo: null, isRetrying: false });
    }, 800);
  };

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || <ErrorFallback 
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          isRetrying={this.state.isRetrying}
          onRetry={this.handleRetry}
          onReload={this.handleReload}
        />
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
  onReload 
}: { 
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isRetrying: boolean;
  onRetry: () => void;
  onReload: () => void;
}) {
  const { isDark } = useTheme();
  
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-900">
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 text-center border border-slate-200 dark:border-slate-700">
        {/* Error icon */}
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
          <svg 
            className="w-10 h-10 text-red-500" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
            aria-hidden="true"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={1.5} 
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
            />
          </svg>
        </div>
        
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
          Something went wrong
        </h1>
        
        <p className="text-slate-500 dark:text-slate-400 mb-6">
          We encountered an unexpected error. Don't worry, your funds are safe.
        </p>
        
        {/* Error details (collapsible) */}
        {error && (
          <details className="mb-6 text-left">
            <summary className="cursor-pointer text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
              Error details
            </summary>
            <div className="mt-2 p-3 bg-slate-100 dark:bg-slate-900 rounded-lg text-xs font-mono text-slate-700 dark:text-slate-300 overflow-auto max-h-40">
              <p className="text-red-500 dark:text-red-400 font-semibold mb-1">{error.message}</p>
              {errorInfo?.componentStack && (
                <pre className="text-slate-500 dark:text-slate-500 whitespace-pre-wrap">{errorInfo.componentStack}</pre>
              )}
            </div>
          </details>
        )}
        
        {/* Action buttons */}
        <div className="flex gap-3">
          <button type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isRetrying ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Retrying...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Try Again</span>
              </>
            )}
          </button>
          
          <button type="button"
            onClick={onReload}
            className="flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium py-3 px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Reload</span>
          </button>
        </div>
        
        {/* Support link */}
        <p className="mt-4 text-sm text-slate-400 dark:text-slate-500">
          Still having issues?{' '}
          <a 
            href="https://t.me/FxAeonBot" 
            className="text-blue-600 dark:text-blue-400 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}

export function ErrorBoundary({ children, fallback, onError }: Props) {
  return (
    <ErrorBoundaryInner fallback={fallback} onError={onError}>
      {children}
    </ErrorBoundaryInner>
  );
}
