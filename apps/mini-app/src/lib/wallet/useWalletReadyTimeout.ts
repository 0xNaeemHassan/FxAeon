'use client';

import { useEffect, useState } from 'react';
import { WALLET_READY_TIMEOUT_MS } from './connectWatch';

/**
 * Privy initialization normally completes quickly. A blocked third-party
 * script, restrictive WebView, or provider outage must not leave a financial
 * screen as an endless skeleton with no recovery action.
 */
export function useWalletReadyTimeout(ready: boolean, timeoutMs = WALLET_READY_TIMEOUT_MS): boolean {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (ready) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [ready, timeoutMs]);

  return !ready && timedOut;
}
