// Transactions of the kb admin services: kb-pipeline's inTx (a drizzle transaction plus
// its persistence context in AsyncLocalStorage), so a call made from inside an engine
// transaction (the eval run handler) joins it, like Spring's REQUIRED propagation.
// The repo functions take the drizzle transaction; pending engine entities are flushed
// first (Hibernate's FlushMode.AUTO before a query).

import type { Database, Db } from '../../db/client';
import { inTx } from '../kb-pipeline/db/session';

export function kbTx<T>(db: Database, fn: (tx: Db) => Promise<T>): Promise<T> {
  return inTx(db, async (s) => {
    await s.flush();
    return fn(s.tx);
  });
}
