// service/drive/DriveBlobs + DriveStorageJanitor. Stored copies are keyed by
// content: drive/<driveId>/<hash of fingerprint>/..., shared by every row with
// the same (driveId, fingerprint); objects are deleted only when no other row
// holds them, after the transaction that drops the rows commits (best effort:
// a failed delete is logged and left behind).

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ObjectStorage } from '../../infra/storage';
import type { Logger } from '../../infra/logger';
import { storageKeys, type DriveFile } from './model';
import type { Session } from './session';

export interface BlobRef { driveId: string; fingerprint: string | null; keys: string[] }

export const refOf = (f: DriveFile): BlobRef => ({ driveId: f.driveId, fingerprint: f.contentFingerprint, keys: storageKeys(f) });

/** DriveBlobs.hash: first 8 bytes of SHA-256(fingerprint) as hex. */
export function blobHash(fingerprint: string | null): string {
  return createHash('sha256').update(String(fingerprint), 'utf8').digest('hex').slice(0, 16);
}

export function blobPrefix(driveId: string, fingerprint: string): string {
  return `drive/${driveId.replace(/[^A-Za-z0-9_-]/g, '_')}/${blobHash(fingerprint)}/`;
}

const NONE = '00000000-0000-0000-0000-000000000000';

/** Keys of `refs` that no row outside `excludedRowIds` still uses. */
export async function releasable(s: Session, refs: BlobRef[], excludedRowIds: string[]): Promise<string[]> {
  const excluded = excludedRowIds.length ? [...new Set(excludedRowIds)] : [NONE];
  const out = new Set<string>();
  const checked = new Set<string>();
  for (const r of refs) {
    if (r.fingerprint == null || r.keys.length === 0) continue;
    if (checked.has(`${r.driveId}\n${r.fingerprint}`)) continue;
    checked.add(`${r.driveId}\n${r.fingerprint}`);
    const [c] = await s.rows(sql`SELECT count(*)::int AS n FROM wiki.drive_file
      WHERE drive_id = ${r.driveId} AND content_fingerprint = ${r.fingerprint}
        AND id NOT IN (${sql.join(excluded.map((i) => sql`${i}::uuid`), sql`, `)})`);
    if (Number(c!.n) === 0) for (const k of r.keys) out.add(k);
  }
  return [...out];
}

export class DriveJanitor {
  constructor(private readonly storage: ObjectStorage, private readonly log: Logger) {}

  /** Inside a session: after it commits; without one: now. */
  deleteAfterCommit(s: Session | null, keys: string[]): void {
    if (keys.length === 0) return;
    const copy = [...keys];
    if (s) s.afterCommit(() => this.deleteNow(copy));
    else void this.deleteNow(copy);
  }

  async deleteNow(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (e) {
        this.log.warn({ key, err: (e as Error).message }, 'Drive sync: could not delete stored object');
      }
    }
  }
}
