export type PriceDemandRegistry = {
  isActive: () => boolean;
  subscribe: (listener: () => void) => () => void;
  acquire: () => () => void;
};

/** Shared demand gate for display-price HTTP and market-stream work. */
export function createPriceDemandRegistry(): PriceDemandRegistry {
  let consumers = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    isActive: () => consumers > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    acquire() {
      consumers += 1;
      notify();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        consumers = Math.max(0, consumers - 1);
        notify();
      };
    },
  };
}

export const priceDemandRegistry = createPriceDemandRegistry();
