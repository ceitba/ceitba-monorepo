// domain/drive: DriveFile, DriveSource, DriveSourceWalk as mutable entities
// (timestamps as Micros), loaded and flushed by session.ts the way Hibernate
// does (identity map, dirty checking, @CreationTimestamp/@UpdateTimestamp).

import type { Micros } from '../../lib/time';
import type { DriveFileKind, DrivePublication, DriveStaffDecision, DriveStorageMode } from './logic/types';

export type DriveSourceStatus = 'PENDING_REVIEW' | 'ACTIVE' | 'BLOCKED' | 'REVOKED' | 'DISCONNECTED' | 'ERROR';
export const SOURCE_STATUSES: DriveSourceStatus[] = ['PENDING_REVIEW', 'ACTIVE', 'BLOCKED', 'REVOKED', 'DISCONNECTED', 'ERROR'];
export type DriveSourceKind = 'STUDENT' | 'COMMUNITY_ROOT' | 'COMMUNITY';
export type DriveAcademicYearSource = 'USER' | 'INHERITED' | 'NAME' | 'DRIVE';
export const PUBLICATIONS: DrivePublication[] = ['PRIVATE', 'NEEDS_REVIEW', 'PUBLISHED', 'HIDDEN_REPORTED', 'REMOVED_BY_STAFF', 'REMOVED'];
export const REPORT_REASONS = ['COPYRIGHT', 'PERSONAL_DATA', 'WRONG_SUBJECT', 'SPAM', 'OTHER'] as const;
export type DriveReportReason = (typeof REPORT_REASONS)[number];

export interface DriveFile {
  id: string;
  sourceId: string;
  driveId: string;
  parentDriveId: string | null;
  name: string;
  mimeType: string;
  kind: DriveFileKind;
  ownerEmail: string | null;
  ownedBySharer: boolean;
  driveVersion: number | null;
  md5Checksum: string | null;
  sizeBytes: number | null;
  driveModifiedAt: Micros | null;
  driveCreatedAt: Micros | null;
  academicYearUser: number | null;
  academicYear: number | null;
  academicYearSource: DriveAcademicYearSource | null;
  subjectId: string | null;
  effectiveSubjectId: string | null;
  suggestedSubjectId: string | null;
  hidden: boolean;
  hiddenByUser: boolean;
  publication: DrivePublication;
  staffDecision: DriveStaffDecision | null;
  publishedAt: Micros | null;
  reportCount: number;
  contentVersion: number | null;
  contentFingerprint: string | null;
  contentModifiedAt: Micros | null;
  htmlContent: string | null;
  pdfKey: string | null;
  originalKey: string | null;
  originalContentType: string | null;
  assetPrefix: string | null;
  assetNames: string[];
  textContent: string | null;
  metadataOnly: boolean;
  exportBlocked: boolean;
  byReference: boolean;
  seenGeneration: number | null;
  syncError: string | null;
  removedAt: Micros | null;
  purgeAfter: Micros | null;
  createdAt: Micros | null;
  updatedAt: Micros | null;
}

export interface DriveSource {
  id: string;
  userId: string | null;
  kind: DriveSourceKind;
  displayName: string | null;
  storageMode: DriveStorageMode;
  subjectId: string | null;
  parentSourceId: string | null;
  ownerEmail: string | null;
  rootFolderId: string;
  rootName: string;
  status: DriveSourceStatus;
  anonymous: boolean;
  consentVersion: string;
  consentedAt: Micros;
  approvedAt: Micros | null;
  reviewedBy: string | null;
  reviewedAt: Micros | null;
  reviewComment: string | null;
  lastSyncedAt: Micros | null;
  lastSyncRequestedAt: Micros | null;
  lastError: string | null;
  consecutiveFailures: number;
  createdAt: Micros | null;
  updatedAt: Micros | null;
}

export interface DriveSourceWalk {
  sourceId: string;
  generation: number;
  startedAt: Micros | null;
  completedAt: Micros | null;
  /** "<depth>/<drive folder id>", in BFS order. */
  frontier: string[];
  rootAncestors: string[];
  incomplete: boolean;
  warning: string | null;
  updatedAt: Micros | null;
}

// ---- DriveFile behaviour -------------------------------------------------------

export function newDriveFile(sourceId: string, driveId: string): DriveFile {
  return {
    id: crypto.randomUUID(), sourceId, driveId, parentDriveId: null, name: '', mimeType: '', kind: 'OTHER', ownerEmail: null,
    ownedBySharer: false, driveVersion: null, md5Checksum: null, sizeBytes: null, driveModifiedAt: null, driveCreatedAt: null,
    academicYearUser: null, academicYear: null, academicYearSource: null, subjectId: null, effectiveSubjectId: null,
    suggestedSubjectId: null, hidden: false, hiddenByUser: false, publication: 'PRIVATE', staffDecision: null, publishedAt: null,
    reportCount: 0, contentVersion: null, contentFingerprint: null, contentModifiedAt: null, htmlContent: null, pdfKey: null,
    originalKey: null, originalContentType: null, assetPrefix: null, assetNames: [], textContent: null, metadataOnly: false,
    exportBlocked: false, byReference: false, seenGeneration: null, syncError: null, removedAt: null, purgeAfter: null,
    createdAt: null, updatedAt: null,
  };
}

/** Every storage key this row references (for deletion). */
export function storageKeys(f: Pick<DriveFile, 'pdfKey' | 'originalKey' | 'assetPrefix' | 'assetNames'>): string[] {
  const keys: string[] = [];
  if (f.pdfKey != null) keys.push(f.pdfKey);
  if (f.originalKey != null && f.originalKey !== f.pdfKey) keys.push(f.originalKey);
  if (f.assetPrefix != null) for (const n of f.assetNames) keys.push(f.assetPrefix + n);
  return keys;
}

export const isFolderFile = (f: DriveFile) => f.kind === 'FOLDER';
export const isRemovedFromDrive = (f: DriveFile) => f.removedAt != null;
export const hasContent = (f: DriveFile) => f.contentFingerprint != null;

/** The student's choice; sticks across syncs. */
export function setHiddenByUser(f: DriveFile, hidden: boolean): void {
  f.hidden = hidden;
  f.hiddenByUser = true;
}

/** Files someone else owns start hidden (folders never); re-applied until the student sets `hidden`. */
export function applyHiddenDefault(f: DriveFile): void {
  if (!f.hiddenByUser) f.hidden = f.kind !== 'FOLDER' && !f.ownedBySharer;
}

export function setAcademicYear(f: DriveFile, year: number | null, source: DriveAcademicYearSource): void {
  f.academicYear = year;
  f.academicYearSource = year == null ? null : source;
}

export interface ContentFields {
  version: number | null; fingerprint: string | null; html: string | null; pdfKey: string | null; originalKey: string | null;
  originalContentType: string | null; assetPrefix: string | null; assetNames: string[]; text: string | null; metadataOnly: boolean;
}

export function setContent(f: DriveFile, c: ContentFields): void {
  f.contentVersion = c.version;
  f.contentFingerprint = c.fingerprint;
  f.htmlContent = c.html;
  f.pdfKey = c.pdfKey;
  f.originalKey = c.originalKey;
  f.originalContentType = c.originalContentType;
  f.assetPrefix = c.assetPrefix;
  f.assetNames = [...c.assetNames];
  f.textContent = c.text;
  f.metadataOnly = c.metadataOnly;
}

// ---- DriveSource behaviour -----------------------------------------------------

export function newDriveSource(userId: string | null, rootFolderId: string, rootName: string, anonymous: boolean,
                               consentVersion: string, consentedAt: Micros): DriveSource {
  return {
    id: crypto.randomUUID(), userId, kind: 'STUDENT', displayName: null, storageMode: 'COPY', subjectId: null, parentSourceId: null,
    ownerEmail: null, rootFolderId, rootName, status: 'PENDING_REVIEW', anonymous, consentVersion, consentedAt, approvedAt: null,
    reviewedBy: null, reviewedAt: null, reviewComment: null, lastSyncedAt: null, lastSyncRequestedAt: null, lastError: null,
    consecutiveFailures: 0, createdAt: null, updatedAt: null,
  };
}

/** DriveSource.community: a community folder (no owning user) under a COMMUNITY_ROOT archive. */
export function communitySource(root: DriveSource, folderId: string, name: string, subjectId: string | null, now: Micros): DriveSource {
  const s = newDriveSource(null, folderId, name, false, 'community', now);
  s.kind = 'COMMUNITY';
  s.displayName = root.displayName;
  s.storageMode = root.storageMode;
  s.parentSourceId = root.id;
  s.ownerEmail = root.ownerEmail;
  s.subjectId = subjectId;
  s.status = 'ACTIVE';
  s.approvedAt = now;
  return s;
}

export const isCommunity = (s: DriveSource) => s.kind !== 'STUDENT';
/** Approved sources (approved_at set) publish while ACTIVE or ERROR. */
export const isApproved = (s: DriveSource) => s.approvedAt != null && (s.status === 'ACTIVE' || s.status === 'ERROR');
/** Statuses whose files may be published at all. */
export const isLive = (s: DriveSource) => s.status === 'ACTIVE' || s.status === 'PENDING_REVIEW' || s.status === 'ERROR';

// ---- DriveSourceWalk ------------------------------------------------------------

export function newWalk(sourceId: string): DriveSourceWalk {
  return { sourceId, generation: 0, startedAt: null, completedAt: null, frontier: [], rootAncestors: [], incomplete: false, warning: null, updatedAt: null };
}

export function startWalk(w: DriveSourceWalk, generation: number, at: Micros, frontier: string[], rootAncestors: string[]): void {
  w.generation = generation;
  w.startedAt = at;
  w.completedAt = null;
  w.frontier = [...frontier];
  w.rootAncestors = [...rootAncestors];
  w.incomplete = false;
  w.warning = null;
}

export function markIncomplete(w: DriveSourceWalk, warning: string | null): void {
  w.incomplete = true;
  if (warning != null) w.warning = warning;
}
