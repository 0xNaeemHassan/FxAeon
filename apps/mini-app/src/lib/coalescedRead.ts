export type ReadCacheEntry<T> = {
  value: T;
  storedAt: number;
};

export type CoalescedReadCache<T> = {
  get: (key: string) => ReadCacheEntry<T> | undefined;
  getFresh: (key: string, nowMs: number, maxAgeMs: number) => T | undefined;
  read: (key: string, loader: () => Promise<T>) => Promise<T>;
  clear: () => void;
};

/** Cache successful reads and share concurrent requests for the same key. */
export function createCoalescedReadCache<T>(): CoalescedReadCache<T> {
  const entries = new Map<string, ReadCacheEntry<T>>();
  const pending = new Map<string, Promise<T>>();
  let generation = 0;

  return {
    get: (key) => entries.get(key),
    getFresh: (key, nowMs, maxAgeMs) => {
      const entry = entries.get(key);
      return entry && nowMs - entry.storedAt <= maxAgeMs ? entry.value : undefined;
    },
    read: (key, loader) => {
      const existing = pending.get(key);
      if (existing) return existing;
      const requestGeneration = generation;
      let loaded: Promise<T>;
      try { loaded = loader(); }
      catch (cause) { loaded = Promise.reject(cause); }
      const request = loaded.then((value) => {
        if (requestGeneration === generation) entries.set(key, { value, storedAt: Date.now() });
        return value;
      });
      const cleanup = () => {
        if (pending.get(key) === request) pending.delete(key);
      };
      pending.set(key, request);
      void request.then(cleanup, cleanup);
      return request;
    },
    clear: () => {
      generation += 1;
      entries.clear();
      pending.clear();
    },
  };
}
