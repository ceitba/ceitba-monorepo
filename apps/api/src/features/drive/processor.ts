// service/drive/DriveContentProcessor: fetches one Drive file and stores our
// copy (see the Java class comment for the per-kind rules, reference mode and
// fingerprints). The CPU-bound steps (Doc zip -> sanitized HTML + hash, PDF
// text) run in the content worker pool (logic/contentPool.ts); Drive and
// storage I/O stay here. Bytes are read into memory capped at
// DRIVE_SYNC_MAX_FILE_BYTES (Java spools to a temp file; at most one file's
// worth per job either way).

import { DriveApiError, type DriveClient } from '../../external/drive';
import type { ObjectStorage } from '../../infra/storage';
import type { Logger } from '../../infra/logger';
import { blobPrefix } from './blobs';
import { ContentPool, ContentWorkError } from './logic/contentPool';
import { bytesFingerprint, NEUTRAL_PREFIX, pdfTextFingerprint, readUtf8, type ParsedDoc } from './logic/contentWork';
import { isTextLike } from './logic/driveMedia';
import { REF } from './logic/driveSyncRules';
import { cap, sameExtraction, type PdfInfo } from './logic/pdfText';
import type { DriveFileKind } from './logic/types';
import type { DriveSyncProps } from './props';
import type { Content } from './store';

export const MAX_HTML_CHARS = 2_000_000;

export interface ProcessRequest {
  fileId: string; driveId: string; kind: DriveFileKind; name: string; mimeType: string | null; version: number | null;
  knownFingerprint: string | null; size: number | null; reference: boolean;
  /** The row's current content (fingerprint, stored text, mode), read only when a Slides/Sheets re-export hashes differently. */
  previous?: () => Promise<PreviousContent | null>;
}

export interface PreviousContent { fingerprint: string | null; text: string | null; byReference: boolean }

class TooLarge extends Error {
  constructor() {
    super('File larger than DRIVE_SYNC_MAX_FILE_BYTES');
  }
}

/** A failure Java reports as "<SimpleName>: <message>" in sync_error. */
export class JavaLikeError extends Error {
  constructor(readonly javaClass: string, message: string) {
    super(message);
  }
}

type HaveCopy = (fp: string) => Promise<boolean>;

function content(version: number | null, fingerprint: string, o: Partial<Content> = {}): Content {
  return {
    version, fingerprint, html: null, pdfKey: null, originalKey: null, originalContentType: null, assetPrefix: null, assetNames: [],
    text: null, metadataOnly: false, existing: false, exportBlocked: false, byReference: false, ...o,
  };
}

const v0 = (v: number | null) => v ?? 0;
const metadataOnly = (r: ProcessRequest) => content(r.version, r.knownFingerprint ?? `meta:${v0(r.version)}:${r.size}`, { metadataOnly: true });
const blocked = (r: ProcessRequest) => content(r.version, `blocked:${v0(r.version)}`, { metadataOnly: true, exportBlocked: true });
const existing = (r: ProcessRequest, fp: string) => content(r.version, fp, { existing: true });
const asReference = (c: Content): Content => ({
  ...c, fingerprint: REF + c.fingerprint, pdfKey: null, originalKey: null, assetPrefix: null, assetNames: [], byReference: true,
});

/** DriveContentProcessor.imageType */
export function imageType(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.bmp')) return 'image/bmp';
  // SVG can carry script: served as an opaque download type, never inline.
  return 'application/octet-stream';
}

function extension(name: string | null): string {
  if (name == null) return '';
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  const ext = name.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

export class DriveContentProcessor {
  constructor(private readonly drive: DriveClient, private readonly storage: ObjectStorage, private readonly props: DriveSyncProps,
              private readonly pool: ContentPool, private readonly log: Logger) {}

  async process(r: ProcessRequest, haveCopy: HaveCopy): Promise<Content> {
    if (!r.reference) return this.fetch(r, haveCopy);
    return asReference(await this.fetch(r, (fp) => haveCopy(REF + fp)));
  }

  private async fetch(r: ProcessRequest, haveCopy: HaveCopy): Promise<Content> {
    if (r.size != null && r.size > this.props.maxFileBytes) return metadataOnly(r);
    const written: string[] = [];
    try {
      switch (r.kind) {
        case 'DOC': return await this.doc(r, haveCopy, written);
        case 'SLIDES': case 'SHEET': return await this.pdfExport(r, haveCopy, written);
        case 'DRAWING': return await this.drawing(r, haveCopy, written);
        case 'PDF': return await this.binary(r, haveCopy, written, true);
        case 'IMAGE': case 'OFFICE': return await this.binary(r, haveCopy, written, false);
        case 'OTHER': return isTextLike(r.mimeType, r.name) ? await this.binary(r, haveCopy, written, false) : metadataOnly(r);
        case 'FOLDER': return metadataOnly(r);
      }
    } catch (e) {
      await this.cleanup(written);
      if (e instanceof TooLarge) return metadataOnly(r);
      if (e instanceof DriveApiError && e.isDownloadBlocked()) return blocked(r);
      throw e;
    }
  }

  // ---- Docs ----------------------------------------------------------------

  private async doc(r: ProcessRequest, haveCopy: HaveCopy, written: string[]): Promise<Content> {
    let parsed: ParsedDoc | null = null;
    try {
      const zip = await this.spool(await this.drive.export(r.driveId, 'application/zip'));
      parsed = await this.parseDoc(zip, r.reference);
    } catch (e) {
      if (!(e instanceof DriveApiError && e.isExportTooLarge())) throw e;
    }
    if (parsed == null) return this.pdfExport(r, haveCopy, written);

    const fp = parsed.fingerprint;
    if (await haveCopy(fp)) return existing(r, fp);
    const html = parsed.html.replaceAll(NEUTRAL_PREFIX, `/api/v1/wiki/files/${r.fileId}/assets/`);
    if (r.reference) {
      return content(r.version, fp, { html: html.length <= MAX_HTML_CHARS ? html : null, text: cap(parsed.text) });
    }
    const prefix = blobPrefix(r.driveId, fp);
    const assets = new Map(parsed.assets);
    for (const asset of parsed.usedAssets) {
      const key = `${prefix}assets/${asset}`;
      await this.storage.put(key, imageType(asset), assets.get(asset)!);
      written.push(key);
    }
    let pdfKey: string | null = null;
    try {
      const pdf = await this.spool(await this.drive.export(r.driveId, 'application/pdf'));
      await this.store(`${prefix}export.pdf`, 'application/pdf', pdf, written);
      pdfKey = `${prefix}export.pdf`;
    } catch (e) {
      if (!(e instanceof DriveApiError && e.isExportTooLarge())) throw e;
    }
    return content(r.version, fp, {
      html: html.length <= MAX_HTML_CHARS ? html : null, pdfKey, assetPrefix: parsed.usedAssets.length ? `${prefix}assets/` : null,
      assetNames: parsed.usedAssets, text: cap(parsed.text),
    });
  }

  private async parseDoc(zip: Uint8Array, withoutImages: boolean): Promise<ParsedDoc> {
    try {
      const res = await this.pool.run({ op: 'doc', zip, withoutImages, maxEntryBytes: this.props.maxFileBytes });
      if (res.op !== 'doc') throw new Error('unexpected worker result');
      return res.doc;
    } catch (e) {
      if (e instanceof ContentWorkError) {
        if (e.detail.tooLarge) throw new TooLarge();
        throw new JavaLikeError(e.detail.javaClass, e.detail.message);
      }
      throw e;
    }
  }

  private async pdfInfo(bytes: Uint8Array): Promise<PdfInfo | null> {
    try {
      const res = await this.pool.run({ op: 'pdf', pdf: bytes });
      return res.op === 'pdf' ? res.info : null;
    } catch {
      return null;
    }
  }

  // ---- Slides, Sheets (and Docs too large for HTML) -----------------------

  private async pdfExport(r: ProcessRequest, haveCopy: HaveCopy, written: string[]): Promise<Content> {
    const file = await this.spool(await this.drive.export(r.driveId, 'application/pdf'));
    const info = await this.pdfInfo(file);
    const fp = info == null ? bytesFingerprint(file) : pdfTextFingerprint(info);
    if (await haveCopy(fp)) return existing(r, fp);
    const kept = info == null ? null : await this.unchangedExtraction(r, cap(info.text));
    if (kept != null) return existing(r, kept);
    let key: string | null = null;
    if (!r.reference) {
      key = `${blobPrefix(r.driveId, fp)}export.pdf`;
      await this.store(key, 'application/pdf', file, written);
    }
    return content(r.version, fp, { pdfKey: key, text: info == null ? null : cap(info.text) });
  }

  /**
   * A Slides/Sheets re-export whose text reads the same as the stored one (sameExtraction) keeps the stored
   * fingerprint: no new copy, no wiki re-digest. The stored fingerprints of the Java era were computed by pdfbox,
   * which pdfjs matches byte for byte on only part of the files; without this, every such file re-exported for a
   * reason other than an edit (rename, reprocess) would count as changed. Same storage mode only (a mode change
   * needs the other kind of copy). Returns the stored fingerprint without the reference prefix, or null.
   */
  private async unchangedExtraction(r: ProcessRequest, text: string | null): Promise<string | null> {
    if ((r.kind !== 'SLIDES' && r.kind !== 'SHEET') || !r.previous) return null;
    const prev = await r.previous();
    if (prev == null || prev.fingerprint == null || prev.byReference !== r.reference) return null;
    const fp = r.reference ? (prev.fingerprint.startsWith(REF) ? prev.fingerprint.slice(REF.length) : null) : prev.fingerprint;
    if (fp == null || !fp.startsWith('sha:') || !sameExtraction(prev.text, text)) return null;
    return fp;
  }

  // ---- Drawings -------------------------------------------------------------

  private async drawing(r: ProcessRequest, haveCopy: HaveCopy, written: string[]): Promise<Content> {
    if (r.reference) {
      const fp = `meta:${v0(r.version)}`;
      if (await haveCopy(fp)) return existing(r, fp);
      return content(r.version, fp, { originalContentType: 'image/png' });
    }
    const file = await this.spool(await this.drive.export(r.driveId, 'image/png'));
    const fp = bytesFingerprint(file);
    if (await haveCopy(fp)) return existing(r, fp);
    const key = `${blobPrefix(r.driveId, fp)}drawing.png`;
    await this.store(key, 'image/png', file, written);
    return content(r.version, fp, { originalKey: key, originalContentType: 'image/png' });
  }

  // ---- Binary files -----------------------------------------------------------

  private async binary(r: ProcessRequest, haveCopy: HaveCopy, written: string[], isPdf: boolean): Promise<Content> {
    if (r.knownFingerprint != null && (await haveCopy(r.knownFingerprint))) return existing(r, r.knownFingerprint);
    const type = isPdf ? 'application/pdf' : (r.mimeType ?? 'application/octet-stream');
    if (r.reference && !isPdf && !isTextLike(type, r.name)) {
      const fp = r.knownFingerprint ?? `meta:${v0(r.version)}:${r.size}`;
      if (await haveCopy(fp)) return existing(r, fp);
      return content(r.version, fp, { originalContentType: type });
    }
    const file = await this.spool(await this.drive.download(r.driveId));
    const fp = r.knownFingerprint ?? bytesFingerprint(file);
    if (r.knownFingerprint == null && (await haveCopy(fp))) return existing(r, fp);
    const prefix = blobPrefix(r.driveId, fp);
    if (isPdf) {
      let key: string | null = null;
      if (!r.reference) {
        key = `${prefix}original.pdf`;
        await this.store(key, 'application/pdf', file, written);
      }
      const info = await this.pdfInfo(file);
      return content(r.version, fp, { pdfKey: key, originalKey: key, originalContentType: 'application/pdf', text: info == null ? null : cap(info.text) });
    }
    let key: string | null = null;
    if (!r.reference) {
      key = `${prefix}original${extension(r.name)}`;
      await this.store(key, type, file, written);
    }
    const text = isTextLike(type, r.name) ? cap(readUtf8(file)) : null;
    return content(r.version, fp, { originalKey: key, originalContentType: type, text });
  }

  // ---- fetch + store ----------------------------------------------------------

  private async store(key: string, type: string, bytes: Uint8Array, written: string[]): Promise<void> {
    await this.storage.put(key, type, bytes);
    written.push(key);
  }

  /** Reads a Drive stream, failing with TooLarge past the max (Java: spool to a temp file). */
  private async spool(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const max = this.props.maxFileBytes;
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > max) throw new TooLarge();
        chunks.push(value);
      }
    } catch (e) {
      await reader.cancel().catch(() => {});
      if (e instanceof TooLarge || e instanceof DriveApiError) throw e;
      throw new DriveApiError(0, 'io', `Reading Drive content failed: ${(e as Error).message}`, e);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  private async cleanup(written: string[]): Promise<void> {
    for (const key of written) {
      try {
        await this.storage.delete(key);
      } catch (e) {
        this.log.warn({ key, err: (e as Error).message }, 'Drive sync: could not delete partial object');
      }
    }
  }
}
