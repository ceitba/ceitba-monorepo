// Port of external/drive/GoogleDriveClient.java: Drive v3 as the bot service
// account, scope drive.readonly. The key is the service-account JSON,
// base64-encoded (raw JSON is accepted too).
//
// Rate limits (429, 403 rateLimitExceeded/userRateLimitExceeded/quotaExceeded)
// and 5xx/I/O errors are retried with exponential back-off and jitter (1s, 2s,
// 4s, + up to 250 ms; 4 attempts); after that the DriveApiError reaches the
// sync, which stops the run. Java's policy is ported by hand: gaxios' own
// retries are off (spike 2, docs/plans/api-bun-spikes.md: by default it retries
// a 429 three times by itself and never a 403 rate limit).
//
// files.list / files.get go through the generated googleapis Drive v3 client
// (only its drive module is loaded, lazily: ~40 ms instead of ~700 ms for the
// whole package). Media (alt=media, export) is fetched directly with the same
// credentials, so an error body (whose `reason` tells "cannotExportFile" from
// "notFound") is read as JSON instead of arriving as an unread stream.

import { javaBase64Decode } from '../../lib/javaCompat';
import { parseIsoInstant, type Micros } from '../../lib/time';
import type { DriveClient, DriveItem } from '../drive';
import { DRIVE_FIELDS, DriveApiError, FOLDER_MIME } from '../drive';

const MAX_ATTEMPTS = 4;
const READ_TIMEOUT_MS = 120_000;
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_MODULE = 'googleapis/build/src/apis/drive/index.js';

interface ServiceAccountKey { client_email: string; private_key: string; token_uri?: string }

/** GoogleDriveClient.decodeKey: raw JSON, or (MIME) base64 of it. */
export function decodeKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.startsWith('{')) return trimmed;
  // Base64.getMimeDecoder() ignores characters outside the alphabet (line breaks...).
  return new TextDecoder().decode(javaBase64Decode(trimmed.replace(/[^A-Za-z0-9+/=]/g, '')));
}

/** java.lang.Escape of q: backslash and quote. */
export const escapeQ = (s: string) => s.replaceAll('\\', '\\\\').replaceAll("'", "\\'");

export interface GoogleDriveOptions {
  /** Test seam: Drive's root URL (default https://www.googleapis.com/). */
  rootUrl?: string;
  /** Test seam: an access-token source instead of the service-account JWT. */
  accessToken?: () => Promise<string>;
  /** Test seam: back-off sleeper. */
  sleep?: (ms: number) => Promise<void>;
}

type DriveV3 = {
  files: {
    get(params: Record<string, unknown>, opts?: Record<string, unknown>): Promise<{ data: Record<string, unknown> }>;
    list(params: Record<string, unknown>, opts?: Record<string, unknown>): Promise<{ data: { files?: Record<string, unknown>[]; nextPageToken?: string | null } }>;
  };
};

export class GoogleDriveClient implements DriveClient {
  private readonly key: ServiceAccountKey;
  private readonly bot: string;
  private readonly rootUrl: string;
  private drivePromise: Promise<{ drive: DriveV3; token: () => Promise<string> }> | null = null;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(serviceAccountKey: string, private readonly opts: GoogleDriveOptions = {}) {
    let parsed: ServiceAccountKey;
    try {
      parsed = JSON.parse(decodeKey(serviceAccountKey)) as ServiceAccountKey;
    } catch (e) {
      throw new Error(`Invalid DRIVE_SYNC_SERVICE_ACCOUNT_JSON: ${(e as Error).message}`);
    }
    if (!parsed || typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
      throw new Error('Invalid DRIVE_SYNC_SERVICE_ACCOUNT_JSON: not a service-account key');
    }
    this.key = parsed;
    this.bot = parsed.client_email;
    this.rootUrl = (opts.rootUrl ?? 'https://www.googleapis.com/').replace(/\/?$/, '/');
    this.sleep = opts.sleep ?? ((ms) => Bun.sleep(ms));
  }

  available(): boolean {
    return true;
  }

  botEmail(): string {
    return this.bot;
  }

  private client() {
    this.drivePromise ??= (async () => {
      const mod = (await import(DRIVE_MODULE)) as {
        auth: { JWT: new (o: { email: string; key: string; scopes: string[] }) => { getAccessToken(): Promise<{ token?: string | null }> } };
        drive_v3: { Drive: new (o: Record<string, unknown>) => DriveV3 };
      };
      let token: () => Promise<string>;
      let auth: unknown;
      if (this.opts.accessToken) {
        token = this.opts.accessToken;
        auth = undefined;
      } else {
        const jwt = new mod.auth.JWT({ email: this.key.client_email, key: this.key.private_key, scopes: [SCOPE] });
        token = async () => {
          const t = (await jwt.getAccessToken()).token;
          if (!t) throw new Error('No access token');
          return t;
        };
        auth = jwt;
      }
      const drive = new mod.drive_v3.Drive({ auth, rootUrl: this.rootUrl, timeout: READ_TIMEOUT_MS, retry: false });
      return { drive, token };
    })();
    return this.drivePromise;
  }

  private async headers(): Promise<Record<string, string>> {
    const { token } = await this.client();
    return { Authorization: `Bearer ${await token()}` };
  }

  async getFile(fileId: string): Promise<DriveItem> {
    return this.withRetry(async () => {
      const { drive } = await this.client();
      const { data } = await drive.files.get({ fileId, fields: DRIVE_FIELDS, supportsAllDrives: true }, await this.reqOpts());
      return toItem(data);
    });
  }

  listChildren(folderId: string): Promise<DriveItem[]> {
    return this.list(`'${escapeQ(folderId)}' in parents and trashed=false`);
  }

  listSharedFolders(): Promise<DriveItem[]> {
    return this.list(`sharedWithMe and mimeType='${FOLDER_MIME}' and trashed=false`);
  }

  private async list(q: string): Promise<DriveItem[]> {
    const out: DriveItem[] = [];
    let pageToken: string | undefined;
    do {
      const token = pageToken;
      const page = await this.withRetry(async () => {
        const { drive } = await this.client();
        return (await drive.files.list({
          q, fields: `nextPageToken,files(${DRIVE_FIELDS})`, pageSize: 1000,
          supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken: token,
        }, await this.reqOpts())).data;
      });
      for (const f of page.files ?? []) out.push(toItem(f));
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  private async reqOpts() {
    // With the JWT as `auth` googleapis adds the bearer itself; the test seam passes the token explicitly.
    return { retry: false, timeout: READ_TIMEOUT_MS, ...(this.opts.accessToken ? { headers: await this.headers() } : {}) };
  }

  export(fileId: string, mimeType: string): Promise<ReadableStream<Uint8Array>> {
    return this.withRetry(() => this.media(`drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType)}`));
  }

  download(fileId: string): Promise<ReadableStream<Uint8Array>> {
    return this.withRetry(() => this.media(`drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`));
  }

  private async media(path: string): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(this.rootUrl + path, { headers: await this.headers(), signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new MediaError(res.status, res.statusText, text);
    }
    return res.body ?? new Blob([]).stream();
  }

  private async withRetry<T>(call: () => Promise<T>): Promise<T> {
    let delayMs = 1000;
    for (let attempt = 1; ; attempt++) {
      try {
        return await call();
      } catch (e) {
        const ex = translate(e);
        if (!ex.isTransient() || attempt >= MAX_ATTEMPTS) throw ex;
        await this.sleep(delayMs + Math.floor(Math.random() * 250));
        delayMs *= 2;
      }
    }
  }
}

class MediaError extends Error {
  constructor(readonly status: number, readonly statusText: string, readonly body: string) {
    super(statusText);
  }
}

interface GoogleErrorBody { error?: { message?: string; errors?: { reason?: string }[] } }

function parseErrorBody(body: unknown): GoogleErrorBody | null {
  if (body && typeof body === 'object') return body as GoogleErrorBody;
  if (typeof body === 'string' && body.trim().startsWith('{')) {
    try {
      return JSON.parse(body) as GoogleErrorBody;
    } catch {
      return null;
    }
  }
  return null;
}

/** GoogleDriveClient.translate: Drive's JSON error (status + first reason + message), else an I/O error (status 0). */
export function translate(e: unknown): DriveApiError {
  if (e instanceof DriveApiError) return e;
  if (e instanceof MediaError) {
    const details = parseErrorBody(e.body)?.error;
    if (details) return new DriveApiError(e.status, details.errors?.[0]?.reason ?? null, details.message ?? e.statusText, e);
    return new DriveApiError(e.status, null, e.statusText, e);
  }
  const g = e as { status?: number; code?: number | string; response?: { status?: number; statusText?: string; data?: unknown }; message?: string; name?: string };
  const status = g.response?.status ?? (typeof g.status === 'number' ? g.status : undefined);
  if (typeof status === 'number' && status > 0) {
    const details = parseErrorBody(g.response?.data)?.error;
    if (details) return new DriveApiError(status, details.errors?.[0]?.reason ?? null, details.message ?? g.message ?? '', e);
    return new DriveApiError(status, null, g.response?.statusText ?? g.message ?? '', e);
  }
  return new DriveApiError(0, 'io', `${g.name ?? 'Error'}: ${g.message ?? String(e)}`, e);
}

function micros(v: unknown): Micros | null {
  return typeof v === 'string' ? parseIsoInstant(v) : null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** files#resource -> DriveItem (RFC 3339 times, `size`/`version` are decimal strings in the JSON). */
export function toItem(f: Record<string, unknown>): DriveItem {
  const owners = Array.isArray(f.owners) ? (f.owners as { emailAddress?: string | null }[]).map((o) => o.emailAddress).filter((x): x is string => x != null) : [];
  const shortcut = f.shortcutDetails as { targetId?: string; targetMimeType?: string } | undefined;
  return {
    id: f.id as string,
    name: f.name as string,
    mimeType: f.mimeType as string,
    parents: Array.isArray(f.parents) ? (f.parents as string[]) : [],
    ownerEmails: owners,
    // Java keeps millisecond precision (DateTime.getValue()).
    modifiedTime: truncMillis(micros(f.modifiedTime)),
    md5Checksum: (f.md5Checksum as string | undefined) ?? null,
    version: num(f.version),
    size: num(f.size),
    shortcutTargetId: shortcut?.targetId ?? null,
    shortcutTargetMimeType: shortcut?.targetMimeType ?? null,
    createdTime: truncMillis(micros(f.createdTime)),
  };
}

const truncMillis = (us: Micros | null) => (us == null ? null : Math.floor(us / 1000) * 1000);
