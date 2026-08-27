'use client';

import { useEffect, useState } from 'react';

/**
 * Privy initialization normally completes quickly. A blocked third-party
 * script, restrictive WebView, or provider outage must not leave a financial
 * screen as an endless skeleton with no recovery action.
 */
export function useWalletReadyTimeout(ready: boolean, timeoutMs = 12_000): boolean {
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
