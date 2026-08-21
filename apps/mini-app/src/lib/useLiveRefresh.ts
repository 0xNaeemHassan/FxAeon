'use client';

import { useEffect } from 'react';

/** Refresh wallet/protocol state whenever Telegram returns this view to the
 * foreground. On-chain state can change outside the current page at any time. */
export function useLiveRefresh(refresh: () => void | Promise<void>): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onFocus = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [refresh]);
}
