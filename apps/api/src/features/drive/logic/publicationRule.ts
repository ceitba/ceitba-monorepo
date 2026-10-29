// Port of apps/api/src/main/java/org/ceitba/api/service/drive/PublicationRule.java.
//
// Whether readers see a file (docs/DRIVE-SYNC.md, "Publish rule"):
//   folder                                     -> PRIVATE (never listed)
//   gone from Drive                            -> REMOVED
//   staff removed it                           -> REMOVED_BY_STAFF
//   no effective subject, or hidden            -> PRIVATE
//   source BLOCKED / REVOKED / DISCONNECTED    -> PRIVATE
//   staff published it                         -> PUBLISHED (sticky; reports ignored)
//   source not approved yet (PENDING_REVIEW)   -> NEEDS_REVIEW (held)
//   owned by someone else than the student     -> NEEDS_REVIEW
//   otherwise                                  -> PUBLISHED, or HIDDEN_REPORTED with >= 3 reports

import type { DriveFileKind, DrivePublication, DriveStaffDecision } from './types';

export const REPORT_THRESHOLD = 3;

export interface PublicationInput {
  kind: DriveFileKind;
  removedFromDrive: boolean;
  staffDecision: DriveStaffDecision | null;
  hasEffectiveSubject: boolean;
  effectivelyHidden: boolean;
  sourceLive: boolean;
  sourceApproved: boolean;
  ownedBySharer: boolean;
  reportCount: number;
}

export function decidePublication(input: PublicationInput): DrivePublication {
  if (input.kind === 'FOLDER') return 'PRIVATE';
  if (input.removedFromDrive) return 'REMOVED';
  if (input.staffDecision === 'REMOVE') return 'REMOVED_BY_STAFF';
  if (!input.hasEffectiveSubject || input.effectivelyHidden) return 'PRIVATE';
  if (!input.sourceLive) return 'PRIVATE';
  if (input.staffDecision === 'PUBLISH') return 'PUBLISHED';
  if (!input.sourceApproved || !input.ownedBySharer) return 'NEEDS_REVIEW';
  return input.reportCount >= REPORT_THRESHOLD ? 'HIDDEN_REPORTED' : 'PUBLISHED';
}
