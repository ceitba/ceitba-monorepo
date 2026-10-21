// web/drive/dto: request schemas (jv.*) and response shapes (record component order).
import { z } from 'zod';
import { jv } from '../../http/validation';
import { REPORT_REASONS } from './model';

// RegisterSourceRequest(@NotBlank @Size(max = 2048) folderUrl, @NotBlank @Size(max = 32) consentVersion, boolean anonymous)
export const RegisterSourceRequest = jv.object({
  folderUrl: jv.string({ notBlank: true, size: { max: 2048 } }),
  consentVersion: jv.string({ notBlank: true, size: { max: 32 } }),
  anonymous: jv.bool({ primitive: true }),
});
export type RegisterSourceRequest = NonNullable<z.output<typeof RegisterSourceRequest>>;

// UpdateSourceRequest(@NotNull Boolean anonymous)
export const UpdateSourceRequest = jv.object({ anonymous: jv.bool({ notNull: true }) });

/** JsonNode academicYear: absent (null) vs explicit null (NullNode) are told apart. */
export const ABSENT = Symbol('absent');
const jsonNode = () => z.any().transform((v: unknown): unknown => (v === undefined ? ABSENT : v));

// UpdateFileRequest(@Size(max = 25) String subjectId, Boolean hidden, JsonNode academicYear)
export const UpdateFileRequest = jv.object({
  subjectId: jv.string({ size: { max: 25 } }),
  hidden: jv.bool(),
  academicYear: jsonNode(),
});
export type UpdateFileRequest = NonNullable<z.output<typeof UpdateFileRequest>>;

// StaffCommentRequest(@Size(max = 2000) String comment)
export const StaffCommentRequest = jv.object({ comment: jv.string({ size: { max: 2000 } }) });

// ReportFileRequest(@NotNull DriveReportReason reason, @Size(max = 2000) String comment)
export const ReportFileRequest = jv.object({
  reason: jv.enum(REPORT_REASONS, { notNull: true }),
  comment: jv.string({ size: { max: 2000 } }),
});
export type ReportFileRequest = NonNullable<z.output<typeof ReportFileRequest>>;

export interface DriveInfoResponse { botEmail: string | null; consentVersion: string; consentText: string }
export interface SourceResponse {
  id: string; rootName: string; status: string; anonymous: boolean; lastSyncedAt: string | null; lastError: string | null;
  fileCount: number; publishedCount: number; needsReviewCount: number; createdAt: string | null; community: boolean;
}
export interface StaffSourceResponse extends SourceResponse { ownerName: string | null; ownerEmail: string | null; subjectId: string | null }
export interface TreeItemResponse {
  id: string; parentId: string | null; name: string; kind: string; subjectId: string | null; subjectName: string | null;
  effectiveSubjectId: string | null; effectiveSubjectName: string | null; suggestedSubjectId: string | null; suggestedSubjectName: string | null;
  suggestedInMyPlan: boolean; effectiveInMyPlan: boolean; hidden: boolean; publication: string; ownedByMe: boolean; sizeBytes: number | null;
  driveModifiedAt: string | null; syncError: string | null; exportBlocked: boolean; driveUrl: string | null; academicYear: number | null;
  academicYearSource: string | null; ownAcademicYear: number | null;
}
export interface SourceTreeResponse { source: SourceResponse; items: TreeItemResponse[] }
export interface AuthorResponse { name: string | null; anonymous: boolean; community: boolean }
export interface FileSummaryResponse {
  id: string; name: string; kind: string; path: string; sizeBytes: number | null; driveModifiedAt: string | null; publishedAt: string | null;
  hasHtml: boolean; hasPdf: boolean; hasOriginal: boolean; pdfMimeType: string | null; originalMimeType: string | null; exportBlocked: boolean;
  driveUrl: string | null; academicYear: number | null; academicYearSource: string | null; community: boolean;
}
export interface FileGroupResponse { sourceId: string; author: AuthorResponse; files: FileSummaryResponse[] }
export interface SubjectFilesResponse { subjectId: string; subjectName: string; groups: FileGroupResponse[] }
export interface ApuntesSubjectResponse {
  subjectId: string; subjectName: string | null; fileCount: number; lastUpdatedAt: string | null; year: number | null;
  semester: number | null; section: string | null; hasWiki: boolean;
}
export interface StaffReportResponse { reason: string; comment: string | null; createdAt: string | null }
export interface StaffFileResponse {
  id: string; name: string; kind: string; sourceId: string; sourceRootName: string | null; ownerEmail: string | null;
  sharerName: string | null; sharerEmail: string | null; effectiveSubjectId: string | null; effectiveSubjectName: string | null;
  publication: string; reportCount: number; reports: StaffReportResponse[]; driveModifiedAt: string | null;
  academicYear: number | null; academicYearSource: string | null;
}
export interface PageResponse<T> { items: T[]; total: number }
export interface UnclaimedShareResponse { name: string; ownerEmail: string | null; firstSeenAt: string | null; lastSeenAt: string | null }
