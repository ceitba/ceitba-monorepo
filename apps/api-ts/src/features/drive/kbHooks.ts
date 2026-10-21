// The two KbModerationService hooks drive calls (service/kb/KbModerationService):
//   hidePagesCiting  takedown: every PUBLISHED wiki page citing one of the
//                    files becomes HIDDEN (TAKEDOWN), whenever a cited file
//                    stops being public or moves to another subject
//   forgetFiles      the rows are about to be deleted: takedown, plus their
//                    digests, the raw text of their DIGEST requests, and the
//                    eval sets' frozen copies of their text (after commit)
// Ported here as SQL on the kb tables until the kb feature owns them; same
// statements as KbPageRepository.findPublishedCitingAny + KbPage.hide,
// KbFileDigestRepository.deleteByFileIds, KbRunRequestRepository.redactDigestRequests.

import { sql } from 'drizzle-orm';
import { systemNowMicros, toPgTimestamp } from '../../lib/time';
import type { DriveJanitor } from './blobs';
import type { Session } from './session';

export async function hidePagesCiting(s: Session, fileIds: string[]): Promise<number> {
  if (fileIds.length === 0) return 0;
  const literal = `{${fileIds.join(',')}}`;
  const rows = await s.rows(sql`UPDATE wiki.kb_page SET status = 'HIDDEN', hidden_reason = 'TAKEDOWN',
      updated_at = ${toPgTimestamp(systemNowMicros())}
    WHERE status = 'PUBLISHED' AND sources && CAST(${literal} AS uuid[]) RETURNING id`);
  return rows.length;
}

export async function forgetFiles(s: Session, janitor: DriveJanitor, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  await hidePagesCiting(s, fileIds);
  await s.rows(sql`DELETE FROM wiki.kb_file_digest WHERE file_id IN ${inList(fileIds)}`);
  await s.rows(sql`UPDATE wiki.kb_run_request SET params = CAST('{}' AS jsonb), result = NULL
    WHERE stage = 'DIGEST' AND target IN ${inList(fileIds)}`);
  const ids = new Set(fileIds);
  const keys: string[] = [];
  for (const set of await s.rows(sql`SELECT id, frozen_inputs FROM wiki.kb_eval_set`)) {
    let frozen = set.frozen_inputs as unknown;
    if (typeof frozen === 'string') frozen = JSON.parse(frozen);
    if (frozen == null || typeof frozen !== 'object') continue;
    for (const subject of Object.values(frozen as Record<string, unknown>)) {
      if (!Array.isArray(subject)) continue;
      for (const input of subject) {
        const fileId = (input as { fileId?: unknown })?.fileId;
        if (typeof fileId === 'string' && ids.has(fileId)) keys.push(`kb/evals/sets/${set.id}/${fileId}.txt`);
      }
    }
  }
  janitor.deleteAfterCommit(s, keys);
}

const inList = (ids: string[]) => sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
