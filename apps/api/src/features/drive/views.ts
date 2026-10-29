// service/drive/DriveViews: entity -> DTO mapping shared by the drive
// services (inside their sessions; entities never leave the services).
// Timestamps print like Jackson prints an OffsetDateTime Hibernate loaded
// (UTC, `Z`); callers pass the JVM zone for values computed in memory.

import { formatOffsetDateTime, type Micros } from '../../lib/time';
import type {
  AuthorResponse, FileSummaryResponse, SourceResponse, StaffSourceResponse, TreeItemResponse,
} from './dto';
import { driveUrl, PDF, servedType } from './logic/driveMedia';
import { hasContent, isCommunity, isFolderFile, type DriveFile, type DriveSource } from './model';
import * as repo from './repo';
import type { Session } from './session';

export const odt = (us: Micros | null, zone = 'UTC'): string | null => (us == null ? null : formatOffsetDateTime(us, zone));

/** String.CASE_INSENSITIVE_ORDER / compareToIgnoreCase: char by char, upper then lower case. */
export function compareIgnoreCase(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let c1 = a[i]!;
    let c2 = b[i]!;
    if (c1 === c2) continue;
    c1 = up(c1);
    c2 = up(c2);
    if (c1 === c2) continue;
    c1 = c1.toLowerCase();
    c2 = c2.toLowerCase();
    if (c1 !== c2) return c1.charCodeAt(0) - c2.charCodeAt(0);
  }
  return a.length - b.length;
}
const up = (c: string) => {
  const u = c.toUpperCase();
  return u.length === 1 ? u : c;
};

export interface UserInfo { id: string; email: string; name: string | null; plan: string | null }

export async function usersById(s: Session, ids: (string | null)[]): Promise<Map<string, UserInfo>> {
  const wanted = [...new Set(ids.filter((x): x is string => x != null))];
  const out = new Map<string, UserInfo>();
  if (!wanted.length) return out;
  for (const r of await repo.usersByIds(s, wanted)) {
    out.set(r.id as string, { id: r.id as string, email: r.email as string, name: (r.name as string) ?? null, plan: (r.plan as string) ?? null });
  }
  return out;
}

export async function subjectNames(s: Session, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => x != null))];
  const out = new Map<string, string>();
  if (!wanted.length) return out;
  for (const r of await repo.subjectsByIds(s, wanted)) {
    out.set(r.id as string, r.name as string);
  }
  return out;
}

interface Counts { files: number; published: number; needsReview: number }

async function counts(s: Session, sourceIds: string[]): Promise<Map<string, Counts>> {
  const out = new Map<string, Counts>();
  if (!sourceIds.length) return out;
  for (const r of await repo.fileCountsBySource(s, sourceIds)) {
    out.set(r.source_id as string, { files: Number(r.files ?? 0), published: Number(r.published ?? 0), needsReview: Number(r.review ?? 0) });
  }
  return out;
}

/** createdAtZone: the JVM zone when createdAt is the in-memory @CreationTimestamp of a source saved in this request. */
function sourceDto(src: DriveSource, c: Counts | undefined, createdAtZone = 'UTC'): SourceResponse {
  const k = c ?? { files: 0, published: 0, needsReview: 0 };
  return {
    id: src.id, rootName: src.rootName, status: src.status, anonymous: src.anonymous, lastSyncedAt: odt(src.lastSyncedAt),
    lastError: src.lastError, fileCount: k.files, publishedCount: k.published, needsReviewCount: k.needsReview,
    createdAt: odt(src.createdAt, createdAtZone), community: isCommunity(src),
  };
}

export async function sources(s: Session, list: DriveSource[]): Promise<SourceResponse[]> {
  const c = await counts(s, list.map((x) => x.id));
  return list.map((x) => sourceDto(x, c.get(x.id)));
}

export async function source(s: Session, src: DriveSource, createdAtZone = 'UTC'): Promise<SourceResponse> {
  return sourceDto(src, (await counts(s, [src.id])).get(src.id), createdAtZone);
}

export async function staffSources(s: Session, list: DriveSource[]): Promise<StaffSourceResponse[]> {
  const c = await counts(s, list.map((x) => x.id));
  const owners = await usersById(s, list.map((x) => x.userId));
  return list.map((x) => {
    const owner = x.userId == null ? undefined : owners.get(x.userId);
    const base = sourceDto(x, c.get(x.id));
    return {
      id: base.id, rootName: base.rootName, status: base.status, anonymous: base.anonymous, lastSyncedAt: base.lastSyncedAt,
      lastError: base.lastError, fileCount: base.fileCount, publishedCount: base.publishedCount, needsReviewCount: base.needsReviewCount,
      createdAt: base.createdAt, ownerName: owner?.name ?? null, ownerEmail: owner?.email ?? null, community: isCommunity(x), subjectId: x.subjectId,
    };
  });
}

export async function tree(s: Session, items: DriveFile[], planSubjects: Set<string>): Promise<TreeItemResponse[]> {
  const idByDriveId = new Map<string, string>();
  for (const f of items) idByDriveId.set(f.driveId, f.id);
  const names = await subjectNames(s, items.flatMap((f) => [f.subjectId, f.effectiveSubjectId, f.suggestedSubjectId]));
  return [...items]
    .sort((a, b) => (isFolderFile(a) !== isFolderFile(b) ? (isFolderFile(a) ? -1 : 1) : compareIgnoreCase(a.name, b.name)))
    .map((f) => treeItem(f, idByDriveId, names, planSubjects));
}

const nameOf = (names: Map<string, string>, id: string | null) => (id == null ? null : (names.get(id) ?? null));

export function treeItem(f: DriveFile, idByDriveId: Map<string, string>, names: Map<string, string>, planSubjects: Set<string>): TreeItemResponse {
  return {
    id: f.id,
    parentId: f.parentDriveId == null ? null : (idByDriveId.get(f.parentDriveId) ?? null),
    name: f.name, kind: f.kind,
    subjectId: f.subjectId, subjectName: nameOf(names, f.subjectId),
    effectiveSubjectId: f.effectiveSubjectId, effectiveSubjectName: nameOf(names, f.effectiveSubjectId),
    suggestedSubjectId: f.suggestedSubjectId, suggestedSubjectName: nameOf(names, f.suggestedSubjectId),
    suggestedInMyPlan: f.suggestedSubjectId != null && planSubjects.has(f.suggestedSubjectId),
    effectiveInMyPlan: f.effectiveSubjectId != null && planSubjects.has(f.effectiveSubjectId),
    hidden: f.hidden, publication: f.publication, ownedByMe: f.ownedBySharer,
    sizeBytes: f.sizeBytes, driveModifiedAt: odt(f.driveModifiedAt), syncError: f.syncError, exportBlocked: f.exportBlocked,
    driveUrl: driveUrl(f.driveId, f.mimeType), academicYear: f.academicYear, academicYearSource: f.academicYearSource,
    ownAcademicYear: f.academicYearUser,
  };
}

export const COMMUNITY_LABEL = 'Comunidad';

/** Community sources show their label, never a contributor. */
export function author(src: DriveSource, owner: UserInfo | undefined): AuthorResponse {
  if (isCommunity(src)) {
    const label = src.displayName == null || src.displayName.trim() === '' ? COMMUNITY_LABEL : src.displayName;
    return { name: label, anonymous: false, community: true };
  }
  if (src.anonymous) return { name: null, anonymous: true, community: false };
  return { name: owner?.name ?? null, anonymous: false, community: false };
}

/** Folder path of `file` inside its source. */
export function path(file: DriveFile, folders: Map<string, DriveFile>): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let parentId = file.parentDriveId;
  while (parentId != null && !seen.has(parentId)) {
    seen.add(parentId);
    const folder = folders.get(parentId);
    if (!folder) break;
    parts.unshift(folder.name);
    parentId = folder.parentDriveId;
  }
  return parts.join('/');
}

export async function foldersBySource(s: Session, sourceIds: string[]): Promise<Map<string, Map<string, DriveFile>>> {
  const out = new Map<string, Map<string, DriveFile>>();
  const ids = [...new Set(sourceIds)];
  if (!ids.length) return out;
  for (const f of await repo.foldersOfSources(s, ids)) {
    if (!out.has(f.sourceId)) out.set(f.sourceId, new Map());
    out.get(f.sourceId)!.set(f.driveId, f);
  }
  return out;
}

const PDF_KINDS = new Set(['PDF', 'DOC', 'SLIDES', 'SHEET']);

export const streamable = (f: DriveFile) => f.byReference && hasContent(f) && !f.metadataOnly && !f.exportBlocked;
export const hasPdf = (f: DriveFile) => f.pdfKey != null || (streamable(f) && PDF_KINDS.has(f.kind));
export const hasOriginal = (f: DriveFile) => f.originalKey != null || (streamable(f) && f.originalContentType != null);
const pdfMimeType = (f: DriveFile) => (hasPdf(f) ? PDF : null);
const originalMimeType = (f: DriveFile) => (hasOriginal(f) ? servedType(f.originalContentType, f.name) : null);

export function summary(f: DriveFile, p: string, community: boolean): FileSummaryResponse {
  return {
    id: f.id, name: f.name, kind: f.kind, path: p, sizeBytes: f.sizeBytes, driveModifiedAt: odt(f.driveModifiedAt),
    publishedAt: odt(f.publishedAt), hasHtml: f.htmlContent != null, hasPdf: hasPdf(f), hasOriginal: hasOriginal(f),
    pdfMimeType: pdfMimeType(f), originalMimeType: originalMimeType(f), exportBlocked: f.exportBlocked,
    driveUrl: driveUrl(f.driveId, f.mimeType), academicYear: f.academicYear, academicYearSource: f.academicYearSource, community,
  };
}

export function detail(f: DriveFile, p: string, subjectName: string | null, a: AuthorResponse, reportedByMe: boolean) {
  return {
    id: f.id, name: f.name, kind: f.kind, path: p, sizeBytes: f.sizeBytes, driveModifiedAt: odt(f.driveModifiedAt),
    publishedAt: odt(f.publishedAt), hasHtml: f.htmlContent != null, hasPdf: hasPdf(f), hasOriginal: hasOriginal(f),
    pdfMimeType: pdfMimeType(f), originalMimeType: originalMimeType(f), exportBlocked: f.exportBlocked,
    driveUrl: driveUrl(f.driveId, f.mimeType), academicYear: f.academicYear, academicYearSource: f.academicYearSource,
    subjectId: f.effectiveSubjectId, subjectName, author: a, html: f.htmlContent, reportedByMe, community: a.community,
  };
}
