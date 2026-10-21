// The two KbModerationService hooks drive calls, through the kb-reader feature
// (kbReader(deps).moderation), inside the drive session's transaction:
//   hidePagesCiting  takedown: every PUBLISHED wiki page citing one of the
//                    files becomes HIDDEN (TAKEDOWN), whenever a cited file
//                    stops being public or moves to another subject
//   forgetFiles      the rows are about to be deleted: takedown, plus their
//                    digests, the raw text of their DIGEST requests, and the
//                    eval sets' frozen copies of their text (after commit)
// The session is flushed first: Hibernate's auto flush before those queries.

import type { Deps } from '../../deps';
import { kbReader } from '../kb-reader/services';
import type { DriveJanitor } from './blobs';
import type { Session } from './session';

export interface KbTakedown {
  hidePagesCiting(s: Session, fileIds: string[]): Promise<number>;
  forgetFiles(s: Session, janitor: DriveJanitor, fileIds: string[]): Promise<void>;
}

export function kbTakedown(deps: Deps): KbTakedown {
  return {
    async hidePagesCiting(s, fileIds) {
      if (fileIds.length === 0) return 0;
      await s.flush();
      return kbReader(deps).moderation.hidePagesCiting(fileIds, s.tx);
    },
    async forgetFiles(s, janitor, fileIds) {
      if (fileIds.length === 0) return;
      await s.flush();
      await kbReader(deps).moderation.forgetFiles(fileIds, s.tx, (keys) => janitor.deleteAfterCommit(s, keys));
    },
  };
}
