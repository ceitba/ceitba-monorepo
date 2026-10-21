// Drive content processing off the event loop (spike 4/§3: sanitizing a 470 KB
// Doc blocks the thread ~160 ms on the main thread, ~3 ms gap from a Worker;
// a text-heavy PDF needs ~350 MB): a small pool of Bun Workers with bounded
// concurrency. At most `size` jobs run at once (default 2, ~2 Docs in flight),
// the rest wait in FIFO order. Workers start lazily, are unref()'d (they never
// keep the process alive) and are restarted after a crash. Java ran this on the
// sync thread; results are identical (same code, structured-cloned).
//
// DRIVE_CONTENT_WORKERS=0 (or a runtime without Worker) runs the work inline.

import { runWork, toWorkError, type WorkError, type WorkRequest, type WorkResult } from './contentWork';

export class ContentWorkError extends Error {
  constructor(readonly detail: WorkError) {
    super(detail.message);
  }
}

interface Job { req: WorkRequest; resolve: (r: WorkResult) => void; reject: (e: unknown) => void }
interface Slot { worker: Worker; busy: Job | null; id: number }

export class ContentPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private seq = 0;
  private closed = false;

  constructor(readonly size = 2) {}

  get inline(): boolean {
    return this.size <= 0 || typeof Worker === 'undefined';
  }

  run(req: WorkRequest): Promise<WorkResult> {
    if (this.inline) {
      return runWork(req).catch((e) => {
        throw new ContentWorkError(toWorkError(e));
      });
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ req, resolve, reject });
      this.pump();
    });
  }

  /** Jobs running + waiting (for tests/metrics). */
  pending(): number {
    return this.queue.length + this.slots.filter((s) => s.busy).length;
  }

  private spawn(): Slot {
    const worker = new Worker(new URL('./contentWorker.ts', import.meta.url).href);
    (worker as unknown as { unref?: () => void }).unref?.();
    const slot: Slot = { worker, busy: null, id: 0 };
    worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; res?: WorkResult; err?: WorkError }>) => {
      const job = slot.busy;
      if (!job || ev.data.id !== slot.id) return;
      slot.busy = null;
      if (ev.data.ok) job.resolve(ev.data.res!);
      else job.reject(new ContentWorkError(ev.data.err!));
      this.pump();
    };
    worker.onerror = (ev) => {
      const job = slot.busy;
      slot.busy = null;
      this.slots.splice(this.slots.indexOf(slot), 1);
      worker.terminate();
      job?.reject(new ContentWorkError({ javaClass: 'RuntimeException', message: `content worker crashed: ${ev.message}` }));
      this.pump();
    };
    this.slots.push(slot);
    return slot;
  }

  private pump(): void {
    if (this.closed) return;
    while (this.queue.length) {
      let slot = this.slots.find((s) => !s.busy);
      if (!slot && this.slots.length < this.size) slot = this.spawn();
      if (!slot) return;
      const job = this.queue.shift()!;
      slot.busy = job;
      slot.id = ++this.seq;
      const transfer: ArrayBuffer[] = [];
      slot.worker.postMessage({ id: slot.id, req: job.req }, transfer);
    }
  }

  close(): void {
    this.closed = true;
    for (const s of this.slots) s.worker.terminate();
    this.slots.length = 0;
    for (const j of this.queue.splice(0)) j.reject(new Error('content pool closed'));
  }
}
