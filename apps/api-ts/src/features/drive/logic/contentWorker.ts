// Bun Worker entry of the content pool (contentPool.ts): runs contentWork.ts
// off the main thread. Messages: { id, req } -> { id, ok, res } | { id, ok: false, err }.
import { runWork, toWorkError, type WorkRequest } from './contentWork';

declare const self: Worker;

self.onmessage = async (ev: MessageEvent<{ id: number; req: WorkRequest }>) => {
  const { id, req } = ev.data;
  try {
    const res = await runWork(req);
    self.postMessage({ id, ok: true, res });
  } catch (e) {
    self.postMessage({ id, ok: false, err: toWorkError(e) });
  }
};
