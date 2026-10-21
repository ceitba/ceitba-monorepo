// external/drive/*: read-only Google Drive as the bot service account.
// Selection (config/DriveSyncConfig): DRIVE_SYNC_USE_FAKE=true -> FakeDriveClient
// (+ DRIVE_SYNC_FAKE_DEMO_OWNERS demo folders); DRIVE_SYNC_SERVICE_ACCOUNT_JSON
// set -> GoogleDriveClient (src/external/drive/google.ts); else Unconfigured
// (available() false; services answer 503 DRIVE_SYNC_UNCONFIGURED). A key that
// cannot be parsed never stops the app: it is logged and the feature is off.

import type { Config } from '../config';
import { javaEqualsIgnoreCase } from '../lib/javaCompat';
import type { Micros } from '../lib/time';
import { FakeDriveClient } from './drive/fake';
import { GoogleDriveClient } from './drive/google';

export const DRIVE_FIELDS = 'id,name,mimeType,parents,owners(emailAddress),createdTime,modifiedTime,md5Checksum,version,size,'
  + 'shortcutDetails(targetId,targetMimeType)';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

/** external/drive/DriveItem: the Drive metadata the sync needs. */
export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  ownerEmails: string[];
  modifiedTime: Micros | null;
  md5Checksum: string | null;
  version: number | null;
  size: number | null;
  shortcutTargetId: string | null;
  shortcutTargetMimeType: string | null;
  createdTime: Micros | null;
}

export const isFolder = (i: DriveItem) => i.mimeType === FOLDER_MIME;
export const isShortcut = (i: DriveItem) => i.mimeType === SHORTCUT_MIME;
/** md5Checksum fingerprint of a binary file; null for native Google files. */
export const binaryFingerprint = (i: DriveItem) => (i.md5Checksum == null ? null : `md5:${i.md5Checksum}`);
export const firstOwner = (i: DriveItem) => i.ownerEmails[0] ?? null;
/** equalsIgnoreCase over the owners. */
export function ownedBy(i: DriveItem, email: string | null | undefined): boolean {
  if (email == null) return false;
  return i.ownerEmails.some((o) => javaEqualsIgnoreCase(email, o));
}

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);

/** DriveApiException: a failed Drive call. status 0 = I/O error (no response); reason = Drive's error reason. */
export class DriveApiError extends Error {
  constructor(readonly status: number, readonly reason: string | null, message: string, override readonly cause?: unknown) {
    super(message);
  }
  isRateLimited(): boolean {
    return this.status === 429 || (this.status === 403 && this.reason != null && RATE_LIMIT_REASONS.has(this.reason));
  }
  /** Worth retrying later: rate limits, 5xx, I/O. */
  isTransient(): boolean {
    return this.isRateLimited() || this.status >= 500 || this.status === 0;
  }
  /** The bot cannot see the item (missing, unshared, no permission). */
  isNotFoundOrForbidden(): boolean {
    return this.status === 404 || (this.status === 403 && !this.isRateLimited() && !this.isExportTooLarge() && !this.isDownloadBlocked());
  }
  /** The owner disabled download/print/copy for viewers. */
  isDownloadBlocked(): boolean {
    return this.reason === 'cannotExportFile' || this.reason === 'cannotDownloadFile';
  }
  isExportTooLarge(): boolean {
    return this.reason === 'exportSizeLimitExceeded';
  }
  static notFound(id: string): DriveApiError {
    return new DriveApiError(404, 'notFound', `File not found: ${id}`);
  }
}

/**
 * Read-only access to Google Drive as the bot service account (drive.readonly).
 * Every call rejects with DriveApiError on failure. export/download return the
 * bytes as a stream (Java: an InputStream the caller closes); callers cap what
 * they read.
 */
export interface DriveClient {
  available(): boolean;
  /** The service account's email, which students share their folder with. */
  botEmail(): string | null;
  getFile(fileId: string): Promise<DriveItem>;
  /** Direct, non-trashed children of a folder (all pages). */
  listChildren(folderId: string): Promise<DriveItem[]>;
  /** Folders shared directly with the bot (sharedWithMe). */
  listSharedFolders(): Promise<DriveItem[]>;
  /** files.export of a native Google file. */
  export(fileId: string, mimeType: string): Promise<ReadableStream<Uint8Array>>;
  /** files.get?alt=media of a binary file. */
  download(fileId: string): Promise<ReadableStream<Uint8Array>>;
}

/** No service-account key: the feature is off (services check available() first). */
export class UnconfiguredDriveClient implements DriveClient {
  private unavailable(): never { throw new Error('Drive sync is not configured (DRIVE_SYNC_SERVICE_ACCOUNT_JSON)'); }
  available() { return false; }
  botEmail() { return null; }
  async getFile(): Promise<DriveItem> { return this.unavailable(); }
  async listChildren(): Promise<DriveItem[]> { return this.unavailable(); }
  async listSharedFolders(): Promise<DriveItem[]> { return this.unavailable(); }
  async export(): Promise<ReadableStream<Uint8Array>> { return this.unavailable(); }
  async download(): Promise<ReadableStream<Uint8Array>> { return this.unavailable(); }
}

export { FakeDriveClient, GoogleDriveClient };

/** config/DriveSyncConfig.driveClient. */
export function createDriveClient(config: Config, log?: { info(o: object, m?: string): void; error(o: object, m?: string): void }): DriveClient {
  const d = config.content.driveSync;
  if (d.useFake) {
    const fake = new FakeDriveClient();
    for (const owner of d.fakeDemoOwners.filter((s) => s.trim() !== '').map((s) => s.trim())) fake.seedDemo(owner);
    log?.info({ demoOwners: d.fakeDemoOwners }, 'Drive sync: using FakeDriveClient');
    return fake;
  }
  if (d.serviceAccountJson.trim() === '') return new UnconfiguredDriveClient();
  try {
    return new GoogleDriveClient(d.serviceAccountJson);
  } catch (e) {
    log?.error({ err: (e as Error).message }, 'Drive sync: DISABLED, the service-account key is unusable');
    return new UnconfiguredDriveClient();
  }
}
