// Object storage port (service/media/ObjectStorage + S3ObjectStorage +
// UnconfiguredObjectStorage, config/StorageConfig; test double
// InMemoryObjectStorage). Selected like Java: S3 when every storage.* field is
// set, otherwise the unconfigured one (every call 501, publicUrl null).

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config';
import { FeatureNotConfiguredError } from '../http/errors';
import type { Clock } from './clock';
import type { Micros } from '../lib/time';
import { javaIsBlank, javaUrlEncode } from '../lib/javaCompat';

export interface PresignedUpload {
  uploadUrl: string;
  /** Headers the client must send (TreeMap order in Java: sorted by name). */
  headers: Record<string, string>;
  expiresAtMicros: Micros;
}

export interface PresignGetOptions {
  filename?: string | null;
  inline?: boolean;
  contentType?: string | null;
}

export interface ObjectStorage {
  readonly configured: boolean;
  presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedUpload>;
  /** Public, unsigned URL of an object, or null when storage is not configured. */
  publicUrl(key: string): string | null;
  put(key: string, contentType: string, body: Uint8Array): Promise<void>;
  /** null when the object does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  presignGet(key: string, ttlMs: number, opts?: PresignGetOptions): Promise<string>;
}

const NOT_CONFIGURED = 'Object storage not configured. Set STORAGE_ENDPOINT, STORAGE_BUCKET, '
  + 'STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY and STORAGE_PUBLIC_URL.';

export class UnconfiguredObjectStorage implements ObjectStorage {
  readonly configured = false;
  presignPut(): Promise<PresignedUpload> { throw new FeatureNotConfiguredError(NOT_CONFIGURED); }
  publicUrl(): string | null { return null; }
  put(): Promise<void> { throw new FeatureNotConfiguredError(NOT_CONFIGURED); }
  get(): Promise<Uint8Array | null> { throw new FeatureNotConfiguredError(NOT_CONFIGURED); }
  delete(): Promise<void> { throw new FeatureNotConfiguredError(NOT_CONFIGURED); }
  presignGet(): Promise<string> { throw new FeatureNotConfiguredError(NOT_CONFIGURED); }
}

/** "content-type" -> "Content-Type" (S3ObjectStorage.canonical). */
export function canonicalHeader(name: string): string {
  return name.toLowerCase().split('-').map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : p)).join('-');
}

function contentDisposition(o: PresignGetOptions): string | undefined {
  if (!o.filename && !o.inline) return undefined;
  const type = o.inline ? 'inline' : 'attachment';
  // S3ObjectStorage.disposition: RFC 6266/5987 ASCII fallback plus the UTF-8 name, as Java builds them.
  if (!o.filename || javaIsBlank(o.filename)) return type;
  const ascii = o.filename.replace(/[^A-Za-z0-9._ -]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${javaUrlEncode(o.filename).replaceAll('+', '%20')}`;
}

/** SigV4 presigning against MinIO (path style), server-side calls via internal-endpoint. */
export class S3ObjectStorage implements ObjectStorage {
  readonly configured = true;
  private readonly presignClient: S3Client;
  private readonly client: S3Client;

  constructor(private readonly cfg: Config['integrations']['storage'], private readonly clock: Clock) {
    const credentials = { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey };
    // Spike 7 (docs/plans/api-bun-spikes.md): without WHEN_REQUIRED the SDK bakes a CRC32 of the
    // empty body into presigned PUT URLs (MinIO answers 403); Content-Type is signed via signableHeaders.
    this.presignClient = new S3Client({
      endpoint: cfg.endpoint, region: cfg.region, credentials, forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    });
    this.client = new S3Client({
      endpoint: cfg.internalEndpoint.trim() ? cfg.internalEndpoint : cfg.endpoint,
      region: cfg.region, credentials, forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedUpload> {
    const ttlSecs = Math.floor(this.cfg.presignTtlMs / 1000);
    const cmd = new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, ContentType: contentType, ContentLength: contentLength });
    const url = await getSignedUrl(this.presignClient, cmd, {
      expiresIn: ttlSecs,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders')?.split(';') ?? [];
    const values: Record<string, string> = { 'content-type': contentType, 'content-length': String(contentLength) };
    const headers: Record<string, string> = {};
    for (const h of signed.filter((n) => n !== 'host').sort()) {
      if (values[h] !== undefined) headers[canonicalHeader(h)] = values[h]!;
    }
    headers['Content-Type'] ??= contentType;
    const sorted = Object.fromEntries(Object.entries(headers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return { uploadUrl: url, headers: sorted, expiresAtMicros: this.clock.now() + this.cfg.presignTtlMs * 1000 };
  }

  publicUrl(key: string): string {
    return `${this.cfg.publicBaseUrl}/${key}`;
  }

  async put(key: string, contentType: string, body: Uint8Array): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, ContentType: contentType, ContentLength: body.byteLength, Body: body }));
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return r.Body ? await r.Body.transformToByteArray() : new Uint8Array();
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async presignGet(key: string, ttlMs: number, o: PresignGetOptions = {}): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.cfg.bucket, Key: key,
      ResponseContentDisposition: contentDisposition(o),
      ResponseContentType: o.contentType ?? undefined,
    });
    return getSignedUrl(this.presignClient, cmd, { expiresIn: Math.floor(ttlMs / 1000) });
  }
}

/** Test double (src/test/java/.../InMemoryObjectStorage): a map and fake signed URLs. */
export class InMemoryObjectStorage implements ObjectStorage {
  readonly configured = true;
  readonly objects = new Map<string, Uint8Array>();
  puts = 0;
  clear() { this.objects.clear(); this.puts = 0; }
  keys(): string[] { return [...this.objects.keys()].sort(); }
  presignPut(): Promise<PresignedUpload> { throw new Error('UnsupportedOperation'); }
  publicUrl(key: string) { return `https://storage.test/${key}`; }
  async put(key: string, _contentType: string, body: Uint8Array) { this.objects.set(key, body); this.puts++; }
  async get(key: string) { return this.objects.get(key) ?? null; }
  async delete(key: string) { this.objects.delete(key); }
  async presignGet(key: string, ttlMs: number, o: PresignGetOptions = {}) {
    const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
    return `https://storage.test/${key}?ttl=${Math.floor(ttlMs / 1000)}&disposition=${o.inline ? 'inline' : 'attachment'}`
      + (o.filename ? `&filename=${enc(o.filename)}` : '') + (o.contentType ? `&type=${enc(o.contentType)}` : '');
  }
}

export function createObjectStorage(config: Config, clock: Clock): ObjectStorage {
  return config.integrations.storage.configured ? new S3ObjectStorage(config.integrations.storage, clock) : new UnconfiguredObjectStorage();
}
