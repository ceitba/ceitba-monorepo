// Spring binds a transaction to the thread: a repository call made deep inside
// the transport (MailSenderAccountService.credentialsFor -> markBroken, called
// by GmailApiEmailSender while DigestService.sendTest runs @Transactional(readOnly
// = true), or while DigestSender holds its send transaction) joins it. The TS
// transport has no tx argument, so callers that hold a transaction around a
// send publish it here and the sender-account code uses it (REQUIRED). The
// mail ledger never does: it is REQUIRES_NEW (always deps.db).

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db, Tx } from '../../db/client';

const ambient = new AsyncLocalStorage<Tx>();

/** Runs `fn` with `tx` as the transaction repository calls of the mail feature join. */
export function withAmbientTx<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  return ambient.run(tx, fn);
}

/** The ambient transaction, else `db` (a call outside any transaction gets its own). */
export function ambientDb(db: Db): Db {
  return ambient.getStore() ?? db;
}
