// Port of external/drive/FakeDriveClient.java: an in-memory Drive
// (DRIVE_SYNC_USE_FAKE=true) for tests and offline dev. Tests build a tree with
// folder()/doc()/file()/shortcut() and mutate it with updateDoc()/updateFile()/
// rename()/move()/remove()/revoke(). Every change bumps the item's version and
// modifiedTime the way Drive does.
//
// Exports: a Doc exports as application/zip (<name>.html + images/*) and as a
// PDF made from the doc's text; Slides/Sheets as PDF; Drawings as PNG. Binary
// files download their bytes.
//
// seedDemo(email) creates folder "demo-<local part>" owned by `email` with a
// small tree (DRIVE_SYNC_FAKE_DEMO_OWNERS), so the local stack works with dev
// login and no Google account.

import { createHash } from 'node:crypto';
import { documentText } from '../../features/drive/logic/jsoup/jsoup';
import { msToMicros, type Micros } from '../../lib/time';
import type { DriveClient, DriveItem } from '../drive';
import { DriveApiError, FOLDER_MIME, SHORTCUT_MIME } from '../drive';
import { fakePdf, storedZip, tinyPng, utf8 } from './fakeContent';

export const FAKE_BOT_EMAIL = 'apuntes-bot@ceitba-dev.iam.gserviceaccount.com';
const DOC = 'application/vnd.google-apps.document';
const EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');

interface Node {
  id: string;
  name: string;
  mimeType: string;
  parent: string | null;
  owner: string | null;
  version: number;
  modified: Micros;
  created: Micros;
  content: Uint8Array | null;
  html: string | null;
  images: Map<string, Uint8Array>;
  shortcutTarget: string | null;
  revoked: boolean;
}

const stream = (b: Uint8Array): ReadableStream<Uint8Array> => new Blob([b as BlobPart]).stream();

export class FakeDriveClient implements DriveClient {
  static readonly BOT_EMAIL = FAKE_BOT_EMAIL;
  static pdf = fakePdf;
  static tinyPng = tinyPng;

  private readonly nodes = new Map<string, Node>();
  private readonly sharedWithBot = new Set<string>();
  private readonly exportTooLarge = new Set<string>();
  private readonly downloadBlocked = new Set<string>();
  private clockMs = EPOCH_MS;
  private readonly fetches = new Map<string, number>();

  // ---- building the tree -------------------------------------------------

  reset(): void {
    this.nodes.clear();
    this.sharedWithBot.clear();
    this.exportTooLarge.clear();
    this.downloadBlocked.clear();
    this.fetches.clear();
    this.clockMs = EPOCH_MS;
  }

  /** How many exports + downloads hit this item (tests assert "no refetch"). */
  fetchCount(id: string): number {
    return this.fetches.get(id) ?? 0;
  }

  /** A folder; with parent null it is a root shared with the bot. */
  folder(id: string, name: string, parent: string | null, owner: string | null): this {
    this.node(id, name, FOLDER_MIME, parent, owner);
    if (parent == null) this.sharedWithBot.add(id);
    return this;
  }

  /** `images` maps file names referenced as images/<name> in the html to bytes. */
  doc(id: string, name: string, parent: string | null, owner: string | null, html: string, images: Map<string, Uint8Array> | Record<string, Uint8Array> = {}): this {
    const n = this.node(id, name, DOC, parent, owner);
    n.html = html;
    for (const [k, v] of images instanceof Map ? images : Object.entries(images)) n.images.set(k, v);
    return this;
  }

  /** Any other file: native Google (slides/sheets/drawing) or binary. */
  file(id: string, name: string, mimeType: string, parent: string | null, owner: string | null, content: Uint8Array | null): this {
    this.node(id, name, mimeType, parent, owner).content = content;
    return this;
  }

  shortcut(id: string, name: string, parent: string | null, owner: string | null, targetId: string): this {
    this.node(id, name, SHORTCUT_MIME, parent, owner).shortcutTarget = targetId;
    return this;
  }

  updateDoc(id: string, html: string): void {
    const n = this.require(id);
    n.html = html;
    this.touch(n);
  }

  updateFile(id: string, content: Uint8Array): void {
    const n = this.require(id);
    n.content = content;
    this.touch(n);
  }

  /** Like Drive: a rename bumps version and modifiedTime, the content stays the same. */
  rename(id: string, name: string): void {
    const n = this.require(id);
    n.name = name;
    this.touch(n);
  }

  /** A move changes only parents (modifiedTime unchanged). */
  move(id: string, newParent: string): void {
    const n = this.require(id);
    n.parent = newParent;
    n.version++;
  }

  /** Deleted or trashed: it disappears from listings and get() answers 404. */
  remove(id: string): void {
    this.nodes.delete(id);
    this.sharedWithBot.delete(id);
  }

  /** The owner unshared the folder: 404 for the folder and everything below. */
  revoke(id: string): void {
    this.require(id).revoked = true;
    this.sharedWithBot.delete(id);
  }

  /** Backdates an item (createdTime and modifiedTime), e.g. "made in 2019". */
  setCreated(id: string, created: Micros | string): void {
    const n = this.require(id);
    const us = typeof created === 'number' ? created : msToMicros(Date.parse(created));
    n.created = us;
    n.modified = us;
    n.version++;
  }

  setExportTooLarge(id: string, tooLarge: boolean): void {
    if (tooLarge) this.exportTooLarge.add(id);
    else this.exportTooLarge.delete(id);
  }

  /** Drive answers 403 cannotExportFile / cannotDownloadFile. Unblocking bumps the version. */
  setDownloadBlocked(id: string, blocked: boolean): void {
    if (blocked) this.downloadBlocked.add(id);
    else this.downloadBlocked.delete(id);
    this.require(id).version++;
  }

  /** Shared with the bot (shows in sharedWithMe) without being registered. */
  share(id: string): void {
    this.sharedWithBot.add(id);
  }

  seedDemo(ownerEmail: string): void {
    const email = ownerEmail.trim().toLowerCase();
    const at = email.indexOf('@');
    const local = at >= 0 ? email.slice(0, at) : email;
    const root = `demo-${local}`;
    this.folder(root, `Apuntes de ${local}`, null, email);
    this.folder(`${root}-fis`, 'Física I', root, email);
    this.doc(`${root}-fis-res`, 'Resumen cinemática', `${root}-fis`, email,
      '<html><body><h1>Cinemática</h1><p>MRU: x = x0 + v t.</p>'
        + '<p><img src="images/image1.png"></p></body></html>',
      new Map([['image1.png', tinyPng()]]));
    this.file(`${root}-fis-tp`, 'TP1 - Vectores.pdf', 'application/pdf', `${root}-fis`, email,
      fakePdf('TP1 Vectores: suma, producto escalar y vectorial.'));
    this.folder(`${root}-am`, 'Analisis Matematico I', root, email);
    this.file(`${root}-am-parc`, 'Parcial resuelto.pdf', 'application/pdf', `${root}-am`, email,
      fakePdf('Parcial resuelto de Análisis Matemático I: límites y derivadas.'));
    this.file(`${root}-am-ajeno`, 'Guía de la cátedra.pdf', 'application/pdf', `${root}-am`,
      'catedra@itba.edu.ar', fakePdf('Guía de ejercicios de la cátedra.'));
    this.folder(`${root}-varios`, 'Varios', root, email);
    this.file(`${root}-varios-img`, 'pizarron.png', 'image/png', `${root}-varios`, email, tinyPng());
  }

  private node(id: string, name: string, mimeType: string, parent: string | null, owner: string | null): Node {
    this.clockMs += 60_000;
    const n: Node = {
      id, name, mimeType, parent, owner, version: 1, modified: msToMicros(this.clockMs), created: msToMicros(this.clockMs),
      content: null, html: null, images: new Map(), shortcutTarget: null, revoked: false,
    };
    this.nodes.set(id, n);
    return n;
  }

  private touch(n: Node): void {
    n.version++;
    this.clockMs += 60_000;
    n.modified = msToMicros(this.clockMs);
  }

  private require(id: string): Node {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`No fake Drive item ${id}`);
    return n;
  }

  // ---- DriveClient -------------------------------------------------------

  available(): boolean {
    return true;
  }

  botEmail(): string {
    return FAKE_BOT_EMAIL;
  }

  async getFile(fileId: string): Promise<DriveItem> {
    const n = this.nodes.get(fileId);
    if (!n || this.revoked(n)) throw DriveApiError.notFound(fileId);
    return this.toItem(n);
  }

  async listChildren(folderId: string): Promise<DriveItem[]> {
    const parent = this.nodes.get(folderId);
    if (!parent || this.revoked(parent)) throw DriveApiError.notFound(folderId);
    const out: DriveItem[] = [];
    for (const n of this.nodes.values()) if (n.parent === folderId) out.push(this.toItem(n));
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }

  async listSharedFolders(): Promise<DriveItem[]> {
    const out: DriveItem[] = [];
    for (const id of this.sharedWithBot) {
      const n = this.nodes.get(id);
      if (n && !this.revoked(n) && n.mimeType === FOLDER_MIME) out.push(this.toItem(n));
    }
    return out;
  }

  async export(fileId: string, mimeType: string): Promise<ReadableStream<Uint8Array>> {
    const n = this.nodes.get(fileId);
    if (!n || this.revoked(n)) throw DriveApiError.notFound(fileId);
    if (!n.mimeType.startsWith('application/vnd.google-apps.')) {
      throw new DriveApiError(403, 'fileNotExportable', 'Only Google files can be exported');
    }
    this.fetches.set(fileId, this.fetchCount(fileId) + 1);
    if (this.downloadBlocked.has(fileId)) throw new DriveApiError(403, 'cannotExportFile', 'This file cannot be exported by the user.');
    if (this.exportTooLarge.has(fileId)) throw new DriveApiError(403, 'exportSizeLimitExceeded', 'This file is too large to be exported.');
    switch (mimeType) {
      case 'application/zip':
        if (n.mimeType !== DOC) throw new DriveApiError(400, 'badRequest', 'Unsupported export');
        return stream(this.zip(n));
      case 'application/pdf':
        return stream(fakePdf(n.mimeType === DOC ? textOf(n.html)
          : `${n.name} ${n.content == null ? '' : new TextDecoder().decode(n.content)}`));
      case 'image/png':
        return stream(n.content ?? tinyPng());
      default:
        throw new DriveApiError(400, 'badRequest', `Unsupported export ${mimeType}`);
    }
  }

  async download(fileId: string): Promise<ReadableStream<Uint8Array>> {
    const n = this.nodes.get(fileId);
    if (!n || this.revoked(n)) throw DriveApiError.notFound(fileId);
    if (n.mimeType.startsWith('application/vnd.google-apps.')) {
      throw new DriveApiError(403, 'fileNotDownloadable', 'Use export for Google files');
    }
    if (this.downloadBlocked.has(fileId)) throw new DriveApiError(403, 'cannotDownloadFile', 'This file cannot be downloaded by the user.');
    this.fetches.set(fileId, this.fetchCount(fileId) + 1);
    return stream(n.content ?? new Uint8Array());
  }

  /** Revoked itself or below a revoked folder. */
  private revoked(n: Node): boolean {
    let cur: Node | undefined = n;
    for (let depth = 0; cur && depth < 100; depth++) {
      if (cur.revoked) return true;
      cur = cur.parent == null ? undefined : this.nodes.get(cur.parent);
    }
    return false;
  }

  private toItem(n: Node): DriveItem {
    const binary = !n.mimeType.startsWith('application/vnd.google-apps.');
    let targetMime: string | null = null;
    if (n.shortcutTarget != null) targetMime = this.nodes.get(n.shortcutTarget)?.mimeType ?? null;
    return {
      id: n.id, name: n.name, mimeType: n.mimeType,
      parents: n.parent == null ? [] : [n.parent],
      ownerEmails: n.owner == null ? [] : [n.owner],
      modifiedTime: n.modified,
      md5Checksum: binary && n.content != null ? createHash('md5').update(n.content).digest('hex') : null,
      version: n.version,
      size: binary && n.content != null ? n.content.length : null,
      shortcutTargetId: n.shortcutTarget, shortcutTargetMimeType: targetMime, createdTime: n.created,
    };
  }

  private zip(n: Node): Uint8Array {
    const entries: [string, Uint8Array][] = [[`${n.name.replace(/[^A-Za-z0-9]+/g, '')}.html`, utf8(n.html ?? '')]];
    for (const [k, v] of n.images) entries.push([`images/${k}`, v]);
    return storedZip(entries);
  }
}

/** Jsoup.parse(html).text() */
function textOf(html: string | null): string {
  return html == null ? '' : documentText(html);
}
