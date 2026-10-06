'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** One visible refresh action may coordinate several independent readers. */
export function useRefreshAction(identity: string) {
  const pending = useRef<{ identity: string; promise: Promise<void> } | null>(null);
  const [busyIdentity, setBusyIdentity] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const run = useCallback((tasks: readonly (() => Promise<unknown>)[]): Promise<void> => {
    if (pending.current?.identity === identity) return pending.current.promise;
    // Invoke readers in microtasks so a synchronous throw cannot strand the
    // spinner or prevent the other readers from refreshing.
    const request = {
      identity,
      promise: Promise.allSettled(tasks.map((task) => Promise.resolve().then(task))).then(() => undefined),
    };
    pending.current = request;
    setBusyIdentity(identity);
    request.promise = request.promise.finally(() => {
      if (pending.current !== request) return;
      pending.current = null;
      if (mounted.current) setBusyIdentity(null);
    });
    return request.promise;
  }, [identity]);
  return { run, refreshing: busyIdentity === identity };
}
