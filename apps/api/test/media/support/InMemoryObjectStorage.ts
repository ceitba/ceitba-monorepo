// Port of apps/api/src/test/java/org/ceitba/api/service/media/InMemoryObjectStorage.java:
// objects in a map, fake signed URLs (https://storage.test/<key>?ttl=<s>&disposition=...).
import type { ObjectStorage, PresignedUpload, PresignGetOptions } from '../../../src/infra/storage';
import { javaUrlEncode } from '../../../src/lib/javaCompat';

export class InMemoryObjectStorage implements ObjectStorage {
  readonly configured = true;
  private readonly objects = new Map<string, Uint8Array>();
  private puts = 0;

  clear(): void {
    this.objects.clear();
    this.puts = 0;
  }
  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
  putCount(): number {
    return this.puts;
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
  presignPut(): Promise<PresignedUpload> {
    throw new Error('UnsupportedOperationException');
  }
  publicUrl(key: string): string {
    return `https://storage.test/${key}`;
  }
  async put(key: string, _contentType: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body);
    this.puts++;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async presignGet(key: string, ttlMs: number, o: PresignGetOptions = {}): Promise<string> {
    return `https://storage.test/${key}?ttl=${Math.floor(ttlMs / 1000)}`
      + `&disposition=${o.inline ? 'inline' : 'attachment'}`
      + (o.filename == null ? '' : `&filename=${javaUrlEncode(o.filename)}`)
      + (o.contentType == null ? '' : `&type=${javaUrlEncode(o.contentType)}`);
  }
}
