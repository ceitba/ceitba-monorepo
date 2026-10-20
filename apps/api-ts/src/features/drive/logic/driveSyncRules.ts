// The pure static rules of apps/api/src/main/java/org/ceitba/api/service/drive/DriveSyncStore.java
// (byReference, needsFetch, REF and the Candidate row shape).
//
// TODO(drive-service): DriveSyncStore itself (fetch candidates, content
// reuse, moves between sources, blob release) is repository code; port it
// with the drive service and keep using these.

import type { Micros } from '../../../lib/time';
import type { DriveFileKind, DriveStorageMode } from './types';

/** REFERENCE sources, and any file above DRIVE_SYNC_REFERENCE_ABOVE_BYTES, keep no binary copy. */
export function byReference(mode: DriveStorageMode | null, size: number | null, referenceAboveBytes: number): boolean {
  return mode === 'REFERENCE' || (size != null && size > referenceAboveBytes);
}

/** The fetch-relevant columns of a row (DriveFileRepository.fetchCandidates). */
export interface FetchCandidate {
  id: string;
  driveId: string;
  kind: DriveFileKind;
  name: string;
  mimeType: string | null;
  version: number | null;
  md5: string | null;
  size: number | null;
  /** OffsetDateTime as micros since the epoch (rows come back from TIMESTAMPTZ, so offsets never differ). */
  modifiedAt: Micros | null;
  fingerprint: string | null;
  contentVersion: number | null;
  contentModifiedAt: Micros | null;
  exportBlocked: boolean;
  byReference: boolean;
}

/**
 * Reference rows' fingerprints carry this prefix, so a reference row and a
 * stored copy of the same content never pass for each other (blob release
 * counts holders by fingerprint).
 */
export const REF = 'ref:';

export function needsFetch(f: FetchCandidate, reference: boolean): boolean {
  if (f.fingerprint == null) return true;
  // Storage mode changed (source mode or size threshold): fetch again.
  if (f.byReference !== reference) return true;
  // Download disabled by the owner: retried whenever Drive reports any change.
  if (f.exportBlocked) return f.version !== f.contentVersion;
  if (f.md5 != null) return `${reference ? REF : ''}md5:${f.md5}` !== f.fingerprint;
  if (f.modifiedAt == null) return f.version !== f.contentVersion;
  return f.modifiedAt !== f.contentModifiedAt;
}
