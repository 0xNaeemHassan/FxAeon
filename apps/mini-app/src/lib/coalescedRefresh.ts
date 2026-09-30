/** Coalesce refresh triggers and ignore completion after the owning view ends. */
export function createCoalescedRefresh<T>(options: {
  fetch: () => Promise<T>;
  onStart: () => void;
  onSuccess: (value: T) => void;
  onError: () => void;
  onSettled: () => void;
}): { refresh: () => Promise<void>; dispose: () => void } {
  let disposed = false;
  let generation = 0;
  let inFlight: Promise<void> | null = null;

  return {
    refresh() {
      if (disposed) return Promise.resolve();
      if (inFlight) return inFlight;

      const request = ++generation;
      options.onStart();
      const task = Promise.resolve()
        .then(options.fetch)
        .then(
          (value) => {
            if (!disposed && request === generation) options.onSuccess(value);
          },
          () => {
            if (!disposed && request === generation) options.onError();
          },
        )
        .finally(() => {
          if (disposed || request !== generation) return;
          inFlight = null;
          options.onSettled();
        });
      inFlight = task;
      return task;
    },
    dispose() {
      disposed = true;
      generation += 1;
      inFlight = null;
    },
  };
}
