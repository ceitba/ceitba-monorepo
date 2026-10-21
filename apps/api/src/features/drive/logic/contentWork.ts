// The CPU-bound part of DriveContentProcessor: what runs in the content worker
// pool (contentPool.ts) so parse5/linkedom, the jsoup printer and pdfjs never
// block the event loop. Pure functions of bytes -> results; Drive and storage
// I/O stay on the main thread.

import { createHash } from 'node:crypto';
import { javaIsBlank } from '../../../lib/javaCompat';
import { pipeline } from './jsoup/pipeline';
import { pdfInfo, type PdfInfo } from './pdfText';
import { readZip, ZipTooLarge } from './zip';

export const MAX_ASSETS = 200;
/** Asset URLs are hashed with this neutral file id and rewritten to the row's id afterwards. */
export const NEUTRAL_FILE = '__FILE__';
export const NEUTRAL_PREFIX = `/api/v1/wiki/files/${NEUTRAL_FILE}/assets/`;

export interface ParsedDoc {
  html: string;
  text: string;
  usedAssets: string[];
  /** asset name -> bytes (every image of the zip, used or not). */
  assets: [string, Uint8Array][];
  fingerprint: string;
}

/** DriveContentProcessor.uniqueAssetName */
export function uniqueAssetName(zipName: string, taken: Set<string>): string {
  let base = zipName.slice(zipName.lastIndexOf('/') + 1).replace(/[^A-Za-z0-9._-]/g, '_');
  if (javaIsBlank(base) || base.startsWith('.')) base = `image${base}`;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${i}-${base}`;
  return name;
}

const isImageName = (name: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name.toLowerCase());

/** "sha:" + 32 hex chars of a SHA-256 (fits content_fingerprint VARCHAR(64)). */
export const shaFingerprint = (h: ReturnType<typeof createHash>) => `sha:${h.digest('hex').slice(0, 32)}`;

/** DriveContentProcessor.parseDoc: the Doc's zip export -> sanitized HTML, text, assets and fingerprint. */
export function parseDocZip(zip: Uint8Array, withoutImages: boolean, maxEntryBytes: number): ParsedDoc {
  let rawHtml: string | null = null;
  const images: [string, Uint8Array][] = [];
  for (const e of readZip(zip, maxEntryBytes)) {
    if (e.directory) continue;
    if (e.name.toLowerCase().endsWith('.html') && rawHtml == null) rawHtml = new TextDecoder().decode(e.data);
    else if (!withoutImages && images.length < MAX_ASSETS && isImageName(e.name)) {
      const i = images.findIndex(([n]) => n === e.name);
      if (i >= 0) images[i] = [e.name, e.data];
      else images.push([e.name, e.data]);
    }
  }
  const srcToAsset = new Map<string, string>();
  const assets = new Map<string, Uint8Array>();
  for (const [name, bytes] of images) {
    const asset = uniqueAssetName(name, new Set(assets.keys()));
    srcToAsset.set(name, asset);
    assets.set(asset, bytes);
  }
  const r = pipeline(rawHtml, srcToAsset, NEUTRAL_PREFIX);
  const h = createHash('sha256').update(`doc\n${r.html}`, 'utf8');
  for (const a of r.usedAssets) {
    h.update(`\n${a}\n`, 'utf8');
    h.update(assets.get(a)!);
  }
  return { html: r.html, text: r.text, usedAssets: r.usedAssets, assets: [...assets], fingerprint: shaFingerprint(h) };
}

/** Slides/Sheets fingerprint: sha("pdf\n" + pages + "\n" + raw text) (bytes carry timestamps). */
export function pdfTextFingerprint(info: PdfInfo): string {
  return shaFingerprint(createHash('sha256').update(`pdf\n${info.pages}\n${info.text}`, 'utf8'));
}

export function bytesFingerprint(b: Uint8Array): string {
  return shaFingerprint(createHash('sha256').update(b));
}

/** Files.readString(file, UTF_8): null on malformed input. */
export function readUtf8(b: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);
  } catch {
    return null;
  }
}

// ---- worker protocol ---------------------------------------------------------

export type WorkRequest =
  | { op: 'doc'; zip: Uint8Array; withoutImages: boolean; maxEntryBytes: number }
  | { op: 'pdf'; pdf: Uint8Array };

export type WorkResult =
  | { op: 'doc'; doc: ParsedDoc }
  | { op: 'pdf'; info: PdfInfo | null };

/** A failure as it crosses the worker boundary: TooLarge, or a Java-style "<Class>: <message>". */
export interface WorkError { tooLarge?: true; javaClass: string; message: string }

export async function runWork(req: WorkRequest): Promise<WorkResult> {
  if (req.op === 'doc') return { op: 'doc', doc: parseDocZip(req.zip, req.withoutImages, req.maxEntryBytes) };
  return { op: 'pdf', info: await pdfInfo(req.pdf) };
}

export function toWorkError(e: unknown): WorkError {
  if (e instanceof ZipTooLarge) return { tooLarge: true, javaClass: 'TooLarge', message: e.message };
  const msg = (e as Error)?.message ?? String(e);
  // Java: URLDecoder's IllegalArgumentException, ZipException (an IOException wrapped as UncheckedIOException)...
  if (msg.startsWith('URLDecoder')) return { javaClass: 'IllegalArgumentException', message: msg };
  return { javaClass: 'UncheckedIOException', message: `java.util.zip.ZipException: ${msg}` };
}
