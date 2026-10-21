// Port of apps/api/src/main/java/org/ceitba/api/service/drive/DriveMedia.java.
//
// How stored copies are served, and links back to Drive. Stored objects sit in
// the media bucket (served from the site's own origin in prod), so only types
// that cannot run script there are served inline: PDF, raster images and
// text-like files (as text/plain; charset=utf-8). Everything else is an attachment.

import { javaTrim } from '../../../lib/javaCompat';
import { FOLDER_MIME } from './types';

export const PDF = 'application/pdf';
export const TEXT = 'text/plain; charset=utf-8';

const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);
const TEXT_MIMES = new Set([
  'application/json', 'application/x-ipynb+json', 'application/vnd.google.colaboratory',
  'application/x-yaml', 'application/yaml', 'application/sql', 'application/x-sh',
  'application/javascript', 'application/x-python-code']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'ipynb', 'yaml', 'yml', 'toml', 'ini', 'log',
  'py', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'js', 'ts', 'jsx', 'tsx',
  'sql', 'sh', 'r', 'm', 'rb', 'php', 'swift', 'scala', 'hs', 'pl', 'lua', 'asm', 's', 'vhd', 'vhdl',
  'tex', 'bib', 'dart', 'gradle']);
// Text that a browser would render as a document if served with its own type.
const ACTIVE_TEXT = new Set(['text/html', 'text/xml', 'image/svg+xml', 'application/xhtml+xml', 'application/xml']);

/** Source code, notebooks, CSV, Markdown, JSON...: stored and shown as text. */
export function isTextLike(mimeType: string | null | undefined, name: string | null | undefined): boolean {
  const mime = base(mimeType);
  if (ACTIVE_TEXT.has(mime)) return false;
  if (mime.startsWith('text/') || TEXT_MIMES.has(mime)) return true;
  return TEXT_EXTENSIONS.has(extension(name));
}

/** The Content-Type the original is served with inline, or null when it must be downloaded. */
export function inlineType(storedType: string | null | undefined, name: string | null | undefined): string | null {
  const mime = base(storedType);
  if (PDF === mime || INLINE_IMAGES.has(mime)) return mime;
  if (isTextLike(storedType, name)) return TEXT;
  return null;
}

/** What FileSummary.originalMimeType reports: the inline type when there is one, else the stored type. */
export function servedType(storedType: string | null | undefined, name: string | null | undefined): string | null {
  if (storedType == null) return null;
  return inlineType(storedType, name) ?? storedType;
}

/** Opens the item in Google Drive (the editor for native files). */
export function driveUrl(driveId: string | null | undefined, mimeType: string | null | undefined): string | null {
  if (driveId == null) return null;
  switch (mimeType ?? '') {
    case 'application/vnd.google-apps.document': return `https://docs.google.com/document/d/${driveId}/edit`;
    case 'application/vnd.google-apps.spreadsheet': return `https://docs.google.com/spreadsheets/d/${driveId}/edit`;
    case 'application/vnd.google-apps.presentation': return `https://docs.google.com/presentation/d/${driveId}/edit`;
    case 'application/vnd.google-apps.drawing': return `https://docs.google.com/drawings/d/${driveId}/edit`;
    case FOLDER_MIME: return `https://drive.google.com/drive/folders/${driveId}`;
    default: return `https://drive.google.com/file/d/${driveId}/view`;
  }
}

function base(mimeType: string | null | undefined): string {
  if (mimeType == null) return '';
  const semi = mimeType.indexOf(';');
  return javaTrimLower(semi >= 0 ? mimeType.slice(0, semi) : mimeType);
}

function extension(name: string | null | undefined): string {
  if (name == null) return '';
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function javaTrimLower(s: string): string {
  return javaTrim(s).toLowerCase();
}

