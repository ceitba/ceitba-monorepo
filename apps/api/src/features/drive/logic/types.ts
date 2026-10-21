// Minimal drive domain types for the pure logic (apps/api/.../domain/drive).

export const DRIVE_FILE_KINDS = ['FOLDER', 'DOC', 'SLIDES', 'SHEET', 'DRAWING', 'PDF', 'IMAGE', 'OFFICE', 'OTHER'] as const;
export type DriveFileKind = (typeof DRIVE_FILE_KINDS)[number];

/** COPY: binaries stored in MinIO. REFERENCE: only text/HTML kept, the rest streamed from Drive. */
export type DriveStorageMode = 'COPY' | 'REFERENCE';

/** Whether readers see a file (computed by PublicationRule). */
export type DrivePublication = 'PRIVATE' | 'NEEDS_REVIEW' | 'PUBLISHED' | 'HIDDEN_REPORTED' | 'REMOVED_BY_STAFF' | 'REMOVED';

/** A STAFF decision on one file that sticks across syncs. */
export type DriveStaffDecision = 'PUBLISH' | 'REMOVE';

/** DriveItem.FOLDER_MIME */
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
