// Port of apps/api/src/main/java/org/ceitba/api/service/kb/KbRunRetentionService.java.
//
// Retention of the pipeline's JSONL in object storage (kb/runs/<runId>/...):
// request payloads carry raw student text, so the objects of finished jobs of
// finished runs go after RETENTION (docs/SUBJECT-WIKI-PIPELINE.md, "Privacy").
// The job's keys are cleared once its objects are deleted. Called nightly by
// KbRelationJob (JobLock id 4, owned by the kb reader side).

import type { Database } from '../../db/client';
import type { Logger } from '../../infra/logger';
import type { ObjectStorage } from '../../infra/storage';
import type { Now } from '../kb/logic/odt';
import { jobs } from './db/repo';
import { inTx } from './db/session';

export const RETENTION_DAYS = 30;
export const BATCH = 200;

/** Every object a job may have written: the payload, its -out / -out-resumed / -err siblings and the recorded output. */
export function keysOf(payloadKey: string | null, outputKey: string | null): string[] {
  const keys = new Set<string>();
  if (payloadKey != null) {
    keys.add(payloadKey);
    if (payloadKey.endsWith('.jsonl')) {
      const base = payloadKey.substring(0, payloadKey.length - '.jsonl'.length);
      keys.add(base + '-out.jsonl');
      keys.add(base + '-out-resumed.jsonl');
      keys.add(base + '-err.jsonl');
    }
  }
  if (outputKey != null) keys.add(outputKey);
  return [...keys];
}

export class KbRunRetentionService {
  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage,
    private readonly now: Now,
    private readonly log: Logger,
  ) {}

  /** The number of jobs whose objects were deleted. Stops at the first storage failure (the next night retries). */
  async purgeExpired(): Promise<number> {
    const before = this.now().plusHours(-RETENTION_DAYS * 24);
    let purged = 0;
    while (true) {
      const rows = await inTx(this.db, () => jobs.expiredObjects(before, BATCH));
      if (rows.length === 0) break;
      const done: string[] = [];
      for (const [id, payloadKey, outputKey] of rows) {
        try {
          for (const key of keysOf(payloadKey, outputKey)) await this.storage.delete(key);
          done.push(id);
        } catch (e) {
          this.log.warn(`KB retention: could not delete the objects of job ${id}: ${(e as Error).message}`);
          break;
        }
      }
      if (done.length > 0) await inTx(this.db, () => jobs.clearObjectKeys(done));
      purged += done.length;
      if (done.length < rows.length) break;
    }
    if (purged > 0) this.log.info(`KB retention: deleted the stored payloads of ${purged} batch jobs`);
    return purged;
  }
}
