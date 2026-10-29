// java.util.concurrent.Semaphore (fair, FIFO) for promises: acquire() resolves when a
// permit is free. Used where the Java kb code bounds concurrent HTTP calls.

export class Semaphore {
  private permits: number;
  private readonly waiters: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  /** acquireUninterruptibly(). */
  acquire(): Promise<void> {
    if (this.permits > 0 && this.waiters.length === 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  tryAcquire(): boolean {
    if (this.permits > 0 && this.waiters.length === 0) {
      this.permits--;
      return true;
    }
    return false;
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits++;
  }

  availablePermits(): number {
    return this.permits;
  }
}
