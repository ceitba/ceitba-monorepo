// Port of apps/api/src/main/java/org/ceitba/api/service/drive/DriveKinds.java.
//
// Drive mimeType -> DriveFileKind; null for items the sync skips entirely (no
// row, no download, not counted): forms, sites, maps, Apps Script, and anything
// the wiki pipeline cannot read (video, audio, archives, executables, CAD...).
// OTHER is only kept for text-like files (DriveMedia.isTextLike). Images are
// kept for student sources and skipped in community sources (allowImages false).

import { isTextLike } from './driveMedia';
import { FOLDER_MIME, type DriveFileKind } from './types';

const OFFICE = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/rtf',
  'text/plain',
  'text/csv',
  'text/markdown']);

/** DriveKinds.of: the kind, or null (Optional.empty()). */
export function driveKindOf(mimeType: string | null | undefined, name: string | null | undefined, allowImages: boolean): DriveFileKind | null {
  if (mimeType == null) return textLike(null, name);
  switch (mimeType) {
    case FOLDER_MIME: return 'FOLDER';
    case 'application/vnd.google-apps.document': return 'DOC';
    case 'application/vnd.google-apps.presentation': return 'SLIDES';
    case 'application/vnd.google-apps.spreadsheet': return 'SHEET';
    case 'application/vnd.google-apps.drawing': return 'DRAWING';
    case 'application/pdf': return 'PDF';
    default:
      if (mimeType.startsWith('application/vnd.google-apps.')) return null;
      if (mimeType.startsWith('image/')) return allowImages ? 'IMAGE' : null;
      if (OFFICE.has(mimeType)) return 'OFFICE';
      return textLike(mimeType, name);
  }
}

function textLike(mimeType: string | null, name: string | null | undefined): DriveFileKind | null {
  return isTextLike(mimeType, name) ? 'OTHER' : null;
}
