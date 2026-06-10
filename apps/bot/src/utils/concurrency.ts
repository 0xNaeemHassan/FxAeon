// Concurrency limiter to prevent Promise.all bombs
export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrency) {
      await new Promise<void>(resolve => {
        // NOTE: Max queue size enforced
        if (this.queue.length >= 1000) throw new Error('Queue full');
        this.queue.push(resolve);
      });
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export const defaultLimiter = new ConcurrencyLimiter(10);
