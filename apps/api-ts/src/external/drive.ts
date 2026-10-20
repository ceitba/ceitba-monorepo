// external/drive/*: read-only Google Drive as the bot service account.
// Selection (config/DriveSyncConfig): DRIVE_SYNC_USE_FAKE=true -> fake;
// DRIVE_SYNC_SERVICE_ACCOUNT_JSON set -> Google; else Unconfigured
// (available() false; services answer 503 DRIVE_SYNC_UNCONFIGURED).
//
// NOT PORTED YET (drive feature agent): GoogleDriveClient (googleapis Drive v3,
// external/drive/GoogleDriveClient.java) and FakeDriveClient's demo content
// (external/drive/FakeDriveClient.java: fake-demo-owners folders, files and
// exports). The InMemoryDriveClient below covers stubbing in tests only.

import type { Config } from '../config';
import type { Micros } from '../lib/time';

export const DRIVE_FIELDS = 'id,name,mimeType,parents,owners(emailAddress),createdTime,modifiedTime,md5Checksum,version,size,'
  + 'shortcutDetails(targetId,targetMimeType)';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

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

/** DriveApiException: a failed Drive call (status 0 = no response). */
export class DriveApiError extends Error {
  constructor(readonly status: number, message: string, readonly reason?: string) {
    super(message);
  }
}

export interface DriveClient {
  available(): boolean;
  botEmail(): string | null;
  getFile(fileId: string): Promise<DriveItem>;
  listChildren(folderId: string): Promise<DriveItem[]>;
  listSharedFolders(): Promise<DriveItem[]>;
  export(fileId: string, mimeType: string): Promise<Uint8Array>;
  download(fileId: string): Promise<Uint8Array>;
}

export class UnconfiguredDriveClient implements DriveClient {
  private unavailable(): never { throw new Error('Drive sync is not configured (DRIVE_SYNC_SERVICE_ACCOUNT_JSON)'); }
  available() { return false; }
  botEmail() { return null; }
  getFile(): Promise<DriveItem> { return this.unavailable(); }
  listChildren(): Promise<DriveItem[]> { return this.unavailable(); }
  listSharedFolders(): Promise<DriveItem[]> { return this.unavailable(); }
  export(): Promise<Uint8Array> { return this.unavailable(); }
  download(): Promise<Uint8Array> { return this.unavailable(); }
}

/** In-memory Drive for tests: add items/contents; 404 DriveApiError otherwise. */
export class InMemoryDriveClient implements DriveClient {
  readonly items = new Map<string, DriveItem>();
  readonly contents = new Map<string, Uint8Array>();
  readonly shared = new Set<string>();
  constructor(private readonly bot = 'bot@ceitba-drive.iam.gserviceaccount.com') {}
  available() { return true; }
  botEmail() { return this.bot; }
  add(item: DriveItem, content?: Uint8Array) {
    this.items.set(item.id, item);
    if (content) this.contents.set(item.id, content);
  }
  async getFile(id: string) {
    const it = this.items.get(id);
    if (!it) throw new DriveApiError(404, `File not found: ${id}.`, 'notFound');
    return it;
  }
  async listChildren(folderId: string) { return [...this.items.values()].filter((i) => i.parents.includes(folderId)); }
  async listSharedFolders() { return [...this.shared].map((id) => this.items.get(id)).filter((i): i is DriveItem => !!i); }
  async export(id: string) { return this.contents.get(id) ?? (await this.getFile(id), new Uint8Array()); }
  async download(id: string) { return this.contents.get(id) ?? (await this.getFile(id), new Uint8Array()); }
}

export function createDriveClient(config: Config): DriveClient {
  const d = config.content.driveSync;
  if (d.useFake) return new InMemoryDriveClient();
  // GoogleDriveClient not ported yet: see header.
  return new UnconfiguredDriveClient();
}
