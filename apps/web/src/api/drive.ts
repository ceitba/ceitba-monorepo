import { ApiError, apiGet, apiSend, BASE_URL } from './client'

// "Apuntes": student notes synced from Google Drive (CEITBA-API drive sync).
// Contract: CEITBA-API docs/DRIVE-SYNC.md. Students share a Drive folder with
// the CEITBA bot account; the API polls it and serves the files per subject.

// ── Shared enums ─────────────────────────────────────────────────────────────

export type SourceStatus =
  | 'PENDING_REVIEW' | 'ACTIVE' | 'BLOCKED' | 'REVOKED' | 'DISCONNECTED' | 'ERROR'

export type Publication =
  | 'PRIVATE' | 'NEEDS_REVIEW' | 'PUBLISHED' | 'HIDDEN_REPORTED' | 'REMOVED_BY_STAFF' | 'REMOVED'

export type FileKind =
  | 'FOLDER' | 'DOC' | 'SLIDES' | 'SHEET' | 'DRAWING' | 'PDF' | 'IMAGE' | 'OFFICE' | 'OTHER'

export type ReportReason = 'COPYRIGHT' | 'PERSONAL_DATA' | 'WRONG_SUBJECT' | 'SPAM' | 'OTHER'

export const REPORT_REASONS: ReportReason[] = ['COPYRIGHT', 'PERSONAL_DATA', 'WRONG_SUBJECT', 'SPAM', 'OTHER']

// Drive-specific `error` codes in the API's {error, message} body.
export type DriveErrorCode =
  | 'DRIVE_INVALID_FOLDER_URL'   // 400
  | 'DRIVE_FOLDER_NOT_SHARED'    // 422
  | 'DRIVE_FOLDER_NOT_OWNED'     // 403
  | 'DRIVE_SOURCE_EXISTS'        // 409
  | 'DRIVE_SYNC_RATE_LIMITED'    // 429
  | 'DRIVE_SYNC_UNCONFIGURED'    // 503

// ── Student (/v1/me/drive) ───────────────────────────────────────────────────

export interface DriveInfo {
  botEmail: string
  consentVersion: string
  consentText: string
}

export interface DriveSource {
  id: string
  rootName: string
  status: SourceStatus
  anonymous: boolean
  lastSyncedAt: string | null
  lastError: string | null
  fileCount: number
  publishedCount: number
  needsReviewCount: number
  createdAt: string
}

export interface TreeItem {
  id: string
  // Another item's id, or null for direct children of the shared folder.
  parentId: string | null
  name: string
  kind: FileKind
  subjectId: string | null
  subjectName: string | null
  effectiveSubjectId: string | null
  effectiveSubjectName: string | null
  suggestedSubjectId: string | null
  suggestedSubjectName: string | null
  // Set only when the item has no effective subject and its own match
  // differs from what it would inherit from its folders' suggestions.
  // The suggestion / effective subject is in the student's own plan.
  suggestedInMyPlan: boolean
  effectiveInMyPlan: boolean
  // Files the student doesn't own start hidden (unhiding sends them to
  // staff review). Folders are never hidden by default.
  hidden: boolean
  publication: Publication
  ownedByMe: boolean
  sizeBytes: number | null
  driveModifiedAt: string | null
  syncError: string | null
  exportBlocked: boolean
  driveUrl: string | null
}

export interface SourceTree {
  source: DriveSource
  items: TreeItem[]
}

export interface CreateSourceBody {
  folderUrl: string
  consentVersion: string
  anonymous: boolean
}

// `subjectId: ""` clears the explicit subject (the item inherits again).
export interface PatchFileBody {
  subjectId?: string
  hidden?: boolean
}

const enc = encodeURIComponent

export function fetchDriveInfo(): Promise<DriveInfo> {
  return apiGet<DriveInfo>('/me/drive/info')
}

export function fetchMySources(): Promise<DriveSource[]> {
  return apiGet<DriveSource[]>('/me/drive/sources')
}

export function createSource(body: CreateSourceBody): Promise<DriveSource> {
  return apiSend<DriveSource>('POST', '/me/drive/sources', body)
}

export function fetchSourceTree(sourceId: string): Promise<SourceTree> {
  return apiGet<SourceTree>(`/me/drive/sources/${enc(sourceId)}/tree`)
}

export function patchSource(sourceId: string, body: { anonymous: boolean }): Promise<DriveSource> {
  return apiSend<DriveSource>('PATCH', `/me/drive/sources/${enc(sourceId)}`, body)
}

export function deleteSource(sourceId: string): Promise<void> {
  return apiSend<void>('DELETE', `/me/drive/sources/${enc(sourceId)}`)
}

// 202, at most once per 5 minutes per source (429 DRIVE_SYNC_RATE_LIMITED).
export function syncSource(sourceId: string): Promise<void> {
  return apiSend<void>('POST', `/me/drive/sources/${enc(sourceId)}/sync`)
}

export function acceptSuggestions(sourceId: string): Promise<{ applied: number }> {
  return apiSend<{ applied: number }>('POST', `/me/drive/sources/${enc(sourceId)}/accept-suggestions`)
}

// Re-runs the subject matcher with the caller's current plan; returns the
// fresh tree.
export function recomputeSuggestions(sourceId: string): Promise<SourceTree> {
  return apiSend<SourceTree>('POST', `/me/drive/sources/${enc(sourceId)}/recompute-suggestions`)
}

export function patchFile(fileId: string, body: PatchFileBody): Promise<TreeItem> {
  return apiSend<TreeItem>('PATCH', `/me/drive/files/${enc(fileId)}`, body)
}

// ── Reader (/v1/wiki, logged in) ─────────────────────────────────────────────

export interface ApunteSubject {
  subjectId: string
  subjectName: string
  fileCount: number
  lastUpdatedAt: string | null
  // Only set with mine=true (plan year / semester), else null.
  year: number | null
  semester: number | null
}

export interface FileSummary {
  id: string
  name: string
  kind: FileKind
  // Folder path inside the source, e.g. "Comunicación/Trabajo Plasticos".
  path: string
  sizeBytes: number | null
  driveModifiedAt: string | null
  publishedAt: string | null
  hasHtml: boolean
  hasPdf: boolean
  hasOriginal: boolean
  // "application/pdf" when hasPdf, else null.
  pdfMimeType: string | null
  // Content-Type the original is served with (text-like files:
  // "text/plain; charset=utf-8"); null without an original.
  originalMimeType: string | null
  // The Drive owner disabled download for viewers: metadata only, no copy.
  exportBlocked: boolean
  // Opens the item in Google Drive.
  driveUrl: string | null
}

export interface ApunteAuthor {
  name: string | null
  anonymous: boolean
}

export interface SubjectFiles {
  subjectId: string
  subjectName: string
  groups: { sourceId: string; author: ApunteAuthor; files: FileSummary[] }[]
}

export interface FileDetail extends FileSummary {
  subjectId: string | null
  subjectName: string | null
  author: ApunteAuthor
  // Server-sanitized HTML; only for Docs.
  html?: string | null
  reportedByMe: boolean
}

// No q: subjects with published files, most recently updated first.
// With q: every subject matching code or name (accent-insensitive).
export function fetchApunteSubjects(q?: string, limit = 20): Promise<ApunteSubject[]> {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (q?.trim()) qs.set('q', q.trim())
  return apiGet<ApunteSubject[]>(`/wiki/apuntes/subjects?${qs}`)
}

// The caller's plan subjects ordered by year/semester ([] without a plan).
export function fetchMyPlanSubjects(): Promise<ApunteSubject[]> {
  return apiGet<ApunteSubject[]>('/wiki/apuntes/subjects?mine=true')
}

export function fetchSubjectFiles(subjectId: string): Promise<SubjectFiles> {
  return apiGet<SubjectFiles>(`/wiki/subjects/${enc(subjectId)}/files`)
}

export function fetchFile(fileId: string): Promise<FileDetail> {
  return apiGet<FileDetail>(`/wiki/files/${enc(fileId)}`)
}

// The endpoint 302s to a 5-minute signed URL, so build the link fresh at
// click/render time instead of caching the redirect target. `inline` (the
// API default) is for viewing, `attachment` forces a download.
export function fileDownloadUrl(
  fileId: string,
  variant: 'pdf' | 'original',
  disposition: 'inline' | 'attachment' = 'inline',
): string {
  return `${BASE_URL}/wiki/files/${enc(fileId)}/download?variant=${variant}&disposition=${disposition}`
}

export class FileTooLargeError extends Error {
  constructor() {
    super('File too large to preview')
    this.name = 'FileTooLargeError'
  }
}

// Fetches the stored original for client-side rendering (docx, sheets,
// text). Follows the redirect to the signed storage URL (same origin in
// prod; local MinIO allows CORS). Refuses anything over `maxBytes`.
// Needs the API and storage on the SPA's origin (Caddy in prod; the Vite
// dev proxy locally): a credentialed fetch that redirects across three
// origins is sent with `Origin: null` and rejected.
export async function fetchOriginal(fileId: string, maxBytes: number): Promise<Blob> {
  const res = await fetch(fileDownloadUrl(fileId, 'original', 'inline'), { credentials: 'include' })
  if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status, 'HTTP_' + res.status)
  const length = Number(res.headers.get('Content-Length'))
  if (Number.isFinite(length) && length > maxBytes) throw new FileTooLargeError()
  const blob = await res.blob()
  if (blob.size > maxBytes) throw new FileTooLargeError()
  return blob
}

export function fileAssetsBaseUrl(fileId: string): string {
  return `${BASE_URL}/wiki/files/${enc(fileId)}/assets/`
}

export function reportFile(fileId: string, body: { reason: ReportReason; comment: string }): Promise<void> {
  return apiSend<void>('PUT', `/wiki/files/${enc(fileId)}/report`, body)
}

// ── Staff (/v1/staff/drive, STAFF role) ─────────────────────────────────────

export interface StaffSource extends DriveSource {
  ownerName: string | null
  ownerEmail: string
}

export interface StaffFileReport {
  reason: ReportReason
  comment: string | null
  createdAt: string
}

export interface StaffFile {
  id: string
  name: string
  kind: FileKind
  sourceId: string
  sourceRootName: string
  ownerEmail: string | null
  sharerName: string | null
  sharerEmail: string | null
  effectiveSubjectId: string | null
  effectiveSubjectName: string | null
  publication: Publication
  reportCount: number
  reports: StaffFileReport[]
  driveModifiedAt: string | null
}

export interface UnclaimedShare {
  name: string
  ownerEmail: string | null
  firstSeenAt: string
  lastSeenAt: string
}

export interface Paged<T> {
  items: T[]
  total: number
}

export type StaffFileQueue = 'NEEDS_REVIEW' | 'HIDDEN_REPORTED'

// page is 0-based.
export function fetchStaffSources(params: { status?: SourceStatus | ''; page?: number; limit?: number }): Promise<Paged<StaffSource>> {
  const qs = new URLSearchParams({ page: String(params.page ?? 0), limit: String(params.limit ?? 20) })
  if (params.status) qs.set('status', params.status)
  return apiGet<Paged<StaffSource>>(`/staff/drive/sources?${qs}`)
}

export function approveSource(id: string, comment?: string): Promise<StaffSource> {
  return apiSend<StaffSource>('POST', `/staff/drive/sources/${enc(id)}/approve`, comment ? { comment } : {})
}

export function blockSource(id: string, comment?: string): Promise<StaffSource> {
  return apiSend<StaffSource>('POST', `/staff/drive/sources/${enc(id)}/block`, comment ? { comment } : {})
}

export function fetchStaffFiles(params: { publication: StaffFileQueue; page?: number; limit?: number }): Promise<Paged<StaffFile>> {
  const qs = new URLSearchParams({
    publication: params.publication,
    page: String(params.page ?? 0),
    limit: String(params.limit ?? 20),
  })
  return apiGet<Paged<StaffFile>>(`/staff/drive/files?${qs}`)
}

export function publishStaffFile(id: string): Promise<StaffFile> {
  return apiSend<StaffFile>('POST', `/staff/drive/files/${enc(id)}/publish`)
}

export function removeStaffFile(id: string): Promise<StaffFile> {
  return apiSend<StaffFile>('POST', `/staff/drive/files/${enc(id)}/remove`)
}

export function restoreStaffFile(id: string): Promise<StaffFile> {
  return apiSend<StaffFile>('POST', `/staff/drive/files/${enc(id)}/restore`)
}

export function fetchUnclaimedShares(): Promise<UnclaimedShare[]> {
  return apiGet<UnclaimedShare[]>('/staff/drive/unclaimed')
}

// ── Dev login (API dev profile + AUTH_DEV_LOGIN_ENABLED only; else 404) ─────

export function devLogin(body: { email: string; name: string; staff: boolean }): Promise<void> {
  return apiSend<void>('POST', '/auth/dev-login', body)
}
