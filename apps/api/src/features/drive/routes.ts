// web/drive: ApuntesController, MyDriveController, StaffDriveController
// (25 operations). Student and reader routes require the `apuntes`
// capability (403 CAPABILITY_REQUIRED, checked in the method body like
// capabilities.require, i.e. after the arguments bound); staff routes are
// STAFF through policy.ts METHOD_RULES (class-level @PreAuthorize).

import type { AppContext } from '../../http/context';
import { staffPowers } from '../../http/auth/context';
import type { UserRow } from '../../http/auth/repo';
import { found, defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import { CapabilityService } from '../capability/service';
import type { Deps } from '../../deps';
import { RegisterSourceRequest, ReportFileRequest, StaffCommentRequest, UpdateFileRequest, UpdateSourceRequest } from './dto';
import { driveServices } from './services';

const APUNTES = 'apuntes';
const BUFFER_KNOWN_LENGTH_UP_TO = 16 * 1024 * 1024;
const tags = ['Apuntes (Drive sync)'];
const staffTags = ['Apuntes (Drive sync) - staff'];

/** CapabilityService.require(user, APUNTES): 403 CAPABILITY_REQUIRED (read in its own read-only transaction). */
function requireApuntes(deps: Deps, user: UserRow): Promise<void> {
  return new CapabilityService(deps).require(user, APUNTES);
}

/** UriUtils.encode(s, UTF_8): everything but RFC 3986 unreserved characters is %-encoded. */
export function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** MediaType.toString(): parameters joined with ';' and no spaces. */
const mediaType = (t: string) => t.split(';').map((p) => p.trim()).join(';');

const staffOf = (c: AppContext) => {
  const p = staffPowers(c);
  return (id: string | null) => p.isStaff(id);
};

export default defineRoutes((r, deps) => {
  const svc = () => driveServices(deps);
  const user = (u: UserRow | null) => u!;

  // ---- MyDriveController (/v1/me/drive) ------------------------------------------

  r.get('/v1/me/drive/info', { tags, summary: 'Bot email to share folders with, and the current consent text/version', currentUser: true },
    async ({ user: u }) => {
      await requireApuntes(deps, user(u));
      return svc().sources.info();
    });
  r.post('/v1/me/drive/sources', { tags, summary: 'Connect a Drive folder shared with the bot', currentUser: true, body: RegisterSourceRequest, status: 201 },
    async ({ user: u, body }) => {
      await requireApuntes(deps, user(u));
      return svc().sources.register(user(u), body);
    });
  r.get('/v1/me/drive/sources', { tags, summary: "The caller's connected folders", currentUser: true }, async ({ user: u }) => {
    await requireApuntes(deps, user(u));
    return svc().sources.list(user(u));
  });
  r.get('/v1/me/drive/sources/{id}/tree', { tags, summary: 'Flat tree of a connected folder with subjects, suggestions and publication', currentUser: true, params: { id: param.uuid() } },
    async ({ user: u, params }) => {
      await requireApuntes(deps, user(u));
      return svc().sources.tree(user(u), params.id!);
    });
  r.patch('/v1/me/drive/sources/{id}', { tags, summary: 'Publish anonymously or with the caller\'s name', currentUser: true, params: { id: param.uuid() }, body: UpdateSourceRequest },
    async ({ user: u, params, body }) => {
      await requireApuntes(deps, user(u));
      return svc().sources.update(user(u), params.id!, body.anonymous!);
    });
  r.delete('/v1/me/drive/sources/{id}', { tags, summary: 'Disconnect a folder: unpublishes and deletes every copied file', currentUser: true, params: { id: param.uuid() }, status: 204 },
    async ({ user: u, params }) => {
      await requireApuntes(deps, user(u));
      await svc().sources.disconnect(user(u), params.id!);
    });
  r.post('/v1/me/drive/sources/{id}/sync', { tags, summary: 'Sync now (at most once per 5 minutes per folder)', currentUser: true, params: { id: param.uuid() }, status: 202 },
    async ({ user: u, params }) => {
      await requireApuntes(deps, user(u));
      await svc().sources.requestSync(user(u), params.id!);
    });
  r.post('/v1/me/drive/sources/{id}/accept-suggestions', { tags, summary: 'Apply every suggested subject (top-down; inherited subjects win)', currentUser: true, params: { id: param.uuid() } },
    async ({ user: u, params }) => {
      await requireApuntes(deps, user(u));
      return svc().sources.acceptSuggestions(user(u), params.id!);
    });
  r.post('/v1/me/drive/sources/{id}/recompute-suggestions', { tags, summary: "Recompute subject suggestions with the caller's current plan; returns the tree", currentUser: true, params: { id: param.uuid() } },
    async ({ user: u, params }) => {
      await requireApuntes(deps, user(u));
      return svc().sources.recomputeSuggestions(user(u), params.id!);
    });
  r.patch('/v1/me/drive/files/{fileId}', { tags, summary: 'Set a file/folder\'s subject ("" clears it) or hide it', currentUser: true, params: { fileId: param.uuid() }, body: UpdateFileRequest },
    async ({ user: u, params, body }) => {
      await requireApuntes(deps, user(u));
      return svc().sources.updateFile(user(u), params.fileId!, body);
    });

  // ---- ApuntesController (readers) ---------------------------------------------

  r.get('/v1/wiki/apuntes/subjects', {
    tags, summary: 'Subjects with published apuntes (no q), subjects matching q by code/name, or (mine=true) the caller\'s plan subjects',
    currentUser: true, query: { q: param.string({ required: false }), limit: param.int({ def: 20, primitive: true }), mine: param.bool({ def: false }) },
  }, async ({ user: u, query }) => {
    await requireApuntes(deps, user(u));
    if (query.mine) return svc().reader.mySubjects(user(u));
    return svc().reader.subjects(query.q, query.limit!);
  });
  r.get('/v1/wiki/subjects/{subjectId}/files', { tags, summary: 'Published apuntes of a subject, grouped by connected folder', currentUser: true, params: { subjectId: param.string() } },
    async ({ user: u, params }) => {
      await requireApuntes(deps, user(u));
      return svc().reader.subjectFiles(params.subjectId!);
    });
  r.get('/v1/wiki/files/{fileId}', { tags, summary: "One file with its sanitized HTML (Docs only)", currentUser: true, params: { fileId: param.uuid() } },
    async ({ c, user: u, params }) => {
      await requireApuntes(deps, user(u));
      return svc().reader.file(user(u), params.fileId!, staffOf(c));
    });
  r.get('/v1/wiki/files/{fileId}/download', {
    tags, summary: '302 to a 5-minute signed URL of the PDF or the original, or (files kept by reference) the bytes streamed from Drive',
    currentUser: true, params: { fileId: param.uuid() }, query: { variant: param.string({ required: false }), disposition: param.string({ required: false }) },
  }, async ({ c, user: u, params, query }) => {
    await requireApuntes(deps, user(u));
    const reader = svc().reader;
    const d = await reader.download(user(u), params.fileId!, query.variant, query.disposition, staffOf(c));
    if (d.redirectUrl != null) return found(d.redirectUrl, { 'Cache-Control': 'no-store' });
    const req = d.stream!;
    const body = reader.capStream(await reader.openStream(req));
    const headers: Record<string, string> = {
      'Content-Type': mediaType(req.contentType),
      'Content-Disposition': `${req.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${uriEncode(req.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    };
    if (req.length != null && req.length <= BUFFER_KNOWN_LENGTH_UP_TO) {
      // Bun sends a ReadableStream body chunked and drops Content-Length; Tomcat keeps it. Files of a known,
      // moderate size are buffered so the header survives (docs/DRIVE-PARITY.md); bigger ones stream chunked.
      headers['Content-Length'] = String(req.length);
      return new Response(await new Response(body).arrayBuffer(), { status: 200, headers });
    }
    return new Response(body, { status: 200, headers });
  });
  r.get('/v1/wiki/files/{fileId}/assets/{name}', { tags, summary: "302 to a signed URL of an image embedded in a Doc's HTML", currentUser: true, params: { fileId: param.uuid(), name: param.string() } },
    async ({ c, user: u, params }) => {
      await requireApuntes(deps, user(u));
      return found(await svc().reader.assetUrl(user(u), params.fileId!, params.name!, staffOf(c)), { 'Cache-Control': 'no-store' });
    });
  r.put('/v1/wiki/files/{fileId}/report', { tags, summary: 'Report a file (one report per user; 3 reports hide it)', currentUser: true, params: { fileId: param.uuid() }, body: ReportFileRequest, status: 204 },
    async ({ user: u, params, body }) => {
      await requireApuntes(deps, user(u));
      await svc().reader.report(user(u), params.fileId!, body);
    });

  // ---- StaffDriveController (/v1/staff/drive, STAFF) ------------------------------

  r.get('/v1/staff/drive/sources', {
    tags: staffTags, summary: 'Connected folders, newest first (optionally by status)',
    query: { status: param.string({ required: false }), page: param.int({ def: 0, primitive: true }), limit: param.int({ def: 20, primitive: true }) },
  }, ({ query }) => svc().moderation.sources(query.status, query.page!, query.limit!));
  r.post('/v1/staff/drive/sources/{id}/approve', {
    tags: staffTags, summary: 'Approve a folder: its own files with a subject get published', currentUser: true, params: { id: param.uuid() },
    body: StaffCommentRequest, bodyOptional: true, argOrder: ['user', 'params', 'body'],
  }, ({ user: u, params, body }) => svc().moderation.approve(user(u).id, params.id!, body?.comment ?? null));
  r.post('/v1/staff/drive/sources/{id}/block', {
    tags: staffTags, summary: 'Block a folder: nothing of it is published', currentUser: true, params: { id: param.uuid() },
    body: StaffCommentRequest, bodyOptional: true, argOrder: ['user', 'params', 'body'],
  }, ({ user: u, params, body }) => svc().moderation.block(user(u).id, params.id!, body?.comment ?? null));
  r.get('/v1/staff/drive/files', {
    tags: staffTags, summary: 'Files by publication (default NEEDS_REVIEW), most recently changed first',
    query: { publication: param.string({ required: false }), page: param.int({ def: 0, primitive: true }), limit: param.int({ def: 20, primitive: true }) },
  }, ({ query }) => svc().moderation.files(query.publication, query.page!, query.limit!));
  r.post('/v1/staff/drive/files/{id}/publish', { tags: staffTags, summary: 'Publish a file (sticks across syncs; reports no longer hide it)', params: { id: param.uuid() } },
    ({ params }) => svc().moderation.publish(params.id!));
  r.post('/v1/staff/drive/files/{id}/remove', { tags: staffTags, summary: 'Remove a file from Apuntes (sticks across syncs)', params: { id: param.uuid() } },
    ({ params }) => svc().moderation.remove(params.id!));
  r.post('/v1/staff/drive/files/{id}/restore', { tags: staffTags, summary: "Undo a staff decision and dismiss the file's reports", params: { id: param.uuid() } },
    ({ params }) => svc().moderation.restore(params.id!));
  r.post('/v1/staff/drive/reprocess', { tags: staffTags, summary: 'Re-export Google files of a kind (default DOC) on a sync queued now', query: { kind: param.string({ required: false }) } },
    ({ query }) => svc().moderation.reprocess(query.kind));
  r.get('/v1/staff/drive/unclaimed', { tags: staffTags, summary: 'Folders shared with the bot that nobody connected' },
    () => svc().moderation.unclaimed());
});
