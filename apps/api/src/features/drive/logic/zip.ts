// java.util.zip.ZipInputStream, as DriveContentProcessor.parseDoc reads a Doc's
// application/zip export: entries in stream order (local headers), STORED or
// DEFLATED, each capped at maxEntryBytes (DriveContentProcessor.readCapped:
// TooLarge past DRIVE_SYNC_MAX_FILE_BYTES). Names are UTF-8 (Java's default).
// Sizes come from the central directory when a local header defers them to a
// data descriptor (general-purpose bit 3).

import { inflateRawSync } from 'node:zlib';

export class ZipTooLarge extends Error {
  constructor() {
    super('File larger than DRIVE_SYNC_MAX_FILE_BYTES');
  }
}

export interface ZipEntry { name: string; directory: boolean; data: Uint8Array }

interface Central { compressed: number; size: number; method: number }

function centralDirectory(b: Uint8Array, dv: DataView): Map<number, Central> {
  const out = new Map<number, Central>();
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count && p + 46 <= b.length && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true);
    const compressed = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    out.set(local, { compressed, size, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Reads every entry; throws ZipTooLarge when one inflates past maxEntryBytes, Error on a corrupt archive. */
export function readZip(b: Uint8Array, maxEntryBytes: number): ZipEntry[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const central = centralDirectory(b, dv);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  let p = 0;
  while (p + 30 <= b.length && dv.getUint32(p, true) === 0x04034b50) {
    const flags = dv.getUint16(p + 6, true);
    let method = dv.getUint16(p + 8, true);
    let compressed = dv.getUint32(p + 18, true);
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const name = dec.decode(b.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extraLen;
    if (flags & 0x08) {
      const c = central.get(p);
      if (!c) throw new Error('ZIP entry without sizes');
      compressed = c.compressed;
      method = c.method;
    }
    const raw = b.subarray(start, start + compressed);
    let data: Uint8Array;
    if (method === 0) {
      if (raw.length > maxEntryBytes) throw new ZipTooLarge();
      data = raw;
    } else if (method === 8) {
      try {
        data = new Uint8Array(inflateRawSync(raw, { maxOutputLength: maxEntryBytes + 1 }));
      } catch (e) {
        if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new ZipTooLarge();
        throw e;
      }
      if (data.length > maxEntryBytes) throw new ZipTooLarge();
    } else {
      throw new Error(`invalid compression method ${method}`);
    }
    out.push({ name, directory: name.endsWith('/'), data });
    p = start + compressed;
    if (flags & 0x08) {
      // data descriptor: optional signature, crc, sizes
      p += dv.getUint32(p, true) === 0x08074b50 ? 16 : 12;
    }
  }
  return out;
}
