// service/drive/DriveSourceService: the student side (/v1/me/drive). Every call
// needs the feature configured (else 503 DRIVE_SYNC_UNCONFIGURED); sources and
// files of other users answer 404.

import type { Deps } from '../../deps';
import { DriveApiError, isFolder, ownedBy, type DriveItem } from '../../external/drive';
import type { UserRow } from '../../http/auth/repo';
import { ExternalApiError, InvalidStateError, ValidationError } from '../../http/errors';
import { DriveJanitor, refOf, releasable } from './blobs';
import type { AcceptSuggestionsResponseT, Ctx } from './context';
import type { DriveInfoResponse, RegisterSourceRequest, SourceResponse, SourceTreeResponse, TreeItemResponse, UpdateFileRequest } from './dto';
import { ABSENT } from './dto';
import { DriveError, fileNotFound, sourceNotFound } from './errors';
import { kbTakedown } from './kbHooks';
import { parseDriveFolderUrl } from './logic/driveFolderUrls';
import { newDriveSource, isRemovedFromDrive, setHiddenByUser, type DriveFile, type DriveSource } from './model';
import { depth, matcher, planSubjectIds, type DriveRecalculator } from './recalculator';
import { yearInZone } from '../../lib/time';
import { inSession, type Session } from './session';
import { filesOfSource } from './store';
import * as repo from './repo';
import * as views from './views';

export const CONSENT_VERSION = '2026-10';
export const CONSENT_TEXT = 'Al conectar esta carpeta autorizás al CEITBA a leer su contenido con una cuenta de servicio de '
  + 'solo lectura, guardar una copia y publicar, en la sección Apuntes, los archivos a los que les asignes una materia. '
  + 'Se publican solo los archivos de tu propiedad; los de otras personas quedan a revisión del staff. Podés ocultar '
  + 'archivos, publicar como anónimo, desconectar la carpeta o dejar de compartirla en cualquier momento: al hacerlo se '
  + 'despublica todo y se borran las copias. No subas datos personales de terceros ni material cuya distribución no esté '
  + 'permitida.';

const MANUAL_SYNC_COOLDOWN_US = 5 * 60_000_000;

export class DriveSourceService {
  constructor(private readonly deps: Deps, private readonly recalculator: DriveRecalculator, private readonly janitor: DriveJanitor,
              private readonly ctx: Ctx) {}

  private get drive() {
    return this.deps.drive;
  }

  requireDriveAvailable(): void {
    if (!this.drive.available()) throw new DriveError('SYNC_UNCONFIGURED', 'Drive sync is not configured on this server');
  }

  info(): DriveInfoResponse {
    this.requireDriveAvailable();
    return { botEmail: this.drive.botEmail(), consentVersion: CONSENT_VERSION, consentText: CONSENT_TEXT };
  }

  private async owned(s: Session, user: UserRow, sourceId: string): Promise<DriveSource> {
    const src = await repo.sourceOwnedBy(s, sourceId, user.id);
    if (!src || src.status === 'DISCONNECTED') throw sourceNotFound(sourceId);
    return src;
  }

  register(user: UserRow, req: RegisterSourceRequest): Promise<SourceResponse> {
    return inSession(this.deps.db, async (s) => {
      this.requireDriveAvailable();
      const folderId = parseDriveFolderUrl(req.folderUrl);
      if (folderId == null) throw new DriveError('INVALID_FOLDER_URL', 'Not a Google Drive folder link');
      if (req.consentVersion !== CONSENT_VERSION) {
        throw new ValidationError('consentVersion', req.consentVersion, `must be the current consent version ${CONSENT_VERSION}`);
      }
      const existing = await repo.connectedSourceOfFolder(s, user.id, folderId);
      if ((await repo.countBlockedSourcesOfFolder(s, folderId)) > 0) throw new DriveError('SOURCE_BLOCKED', 'This folder was blocked by staff');
      if (existing && existing.status !== 'REVOKED') throw new DriveError('SOURCE_EXISTS', 'This folder is already connected');

      const folder = await this.fetchFolder(folderId);
      if (!isFolder(folder)) throw new DriveError('INVALID_FOLDER_URL', 'The link is not a folder');
      if (!ownedBy(folder, user.email)) throw new DriveError('FOLDER_NOT_OWNED', 'Only the owner of the folder can connect it');

      const now = this.deps.clock.now();
      let source: DriveSource;
      let createdNow = false;
      if (existing) {
        source = existing;
        source.rootName = folder.name;
        source.anonymous = req.anonymous!;
        source.consentVersion = CONSENT_VERSION;
        source.consentedAt = now;
        source.lastError = null;
        source.consecutiveFailures = 0;
        source.status = source.approvedAt != null ? 'ACTIVE' : 'PENDING_REVIEW';
      } else {
        source = newDriveSource(user.id, folderId, folder.name, req.anonymous!, CONSENT_VERSION, now);
        if ((await repo.countActiveSourcesOfUser(s, user.id)) > 0) {
          source.status = 'ACTIVE';
          source.approvedAt = now;
        }
        s.persistSource(source);
        await s.flush(); // saveAndFlush: @CreationTimestamp filled in for the response
        createdNow = true;
      }
      await repo.deleteUnclaimedShare(s, folderId);
      source.lastSyncRequestedAt = now;
      const id = source.id;
      s.afterCommit(() => this.ctx.trigger.request(id));
      // createdAt of a source saved now is Java's in-memory @CreationTimestamp (JVM zone offset).
      return views.source(s, source, createdNow ? this.deps.config.server.timeZone : 'UTC');
    });
  }

  private async fetchFolder(folderId: string): Promise<DriveItem> {
    try {
      return await this.drive.getFile(folderId);
    } catch (e) {
      if (e instanceof DriveApiError && e.isNotFoundOrForbidden()) {
        throw new DriveError('FOLDER_NOT_SHARED', `The folder is not shared with ${this.drive.botEmail()}`);
      }
      throw new ExternalApiError('Google Drive', 'files.get', e);
    }
  }

  list(user: UserRow): Promise<SourceResponse[]> {
    return inSession(this.deps.db, async (s) => {
      this.requireDriveAvailable();
      return views.sources(s, await repo.connectedSourcesOfUser(s, user.id));
    }, { readOnly: true });
  }

  tree(user: UserRow, sourceId: string): Promise<SourceTreeResponse> {
    return inSession(this.deps.db, async (s) => {
      this.requireDriveAvailable();
      const source = await this.owned(s, user, sourceId);
      return { source: await views.source(s, source), items: await views.tree(s, await filesOfSource(s, sourceId), new Set(await planSubjectIds(s, user.id))) };
    }, { readOnly: true });
  }

  recomputeSuggestions(user: UserRow, sourceId: string): Promise<SourceTreeResponse> {
    return inSession(this.deps.db, async (s) => {
      this.requireDriveAvailable();
      const source = await this.owned(s, user, sourceId);
      const all = await filesOfSource(s, sourceId);
      const plan = await planSubjectIds(s, user.id);
      await this.recalculator.recompute(s, source, all, await matcher(s, plan));
      return { source: await views.source(s, source), items: await views.tree(s, all, new Set(plan)) };
    });
  }

  update(user: UserRow, sourceId: string, anonymous: boolean): Promise<SourceResponse> {
    return inSession(this.deps.db, async (s) => {
      this.requireDriveAvailable();
      const source = await this.owned(s, user, sourceId);
      source.anonymous = anonymous;
      return views.source(s, source);
    });
  }

  disconnect(user: UserRow, sourceId: string): Promise<void> {
    return inSession(this.deps.db, async (s) => {
      this.requireDriveAvailable();
      await this.owned(s, user, sourceId);
      const source = await s.sourceById(sourceId, true);
      if (!source) throw sourceNotFound(sourceId);
      if (source.status === 'BLOCKED') throw new DriveError('SOURCE_BLOCKED', 'A folder blocked by staff cannot be disconnected');
      source.status = 'DISCONNECTED';
      const all = await filesOfSource(s, sourceId);
      const refs = all.map(refOf);
      const ids = all.map((f) => f.id);
      await kbTakedown(this.deps).forgetFiles(s, this.janitor, ids);
      for (const f of all) s.deleteFile(f);
      this.janitor.deleteAfterCommit(s, await releasable(s, refs, ids));
    });
  }

  requestSync(user: UserRow, sourceId: string): Promise<void> {
    return inSession(this.deps.db, async (s) => {
      this.requireDriveAvailable();
      const source = await this.owned(s, user, sourceId);
      if (source.status === 'BLOCKED') throw new InvalidStateError('This folder was blocked by staff');
      const now = this.deps.clock.now();
      const last = source.lastSyncRequestedAt;
      if (last != null && last + MANUAL_SYNC_COOLDOWN_US > now) {
        // Duration.between(now, last + 5m).toSeconds() + 1
        const wait = Math.floor((last + MANUAL_SYNC_COOLDOWN_US - now) / 1_000_000) + 1;
        throw new DriveError('SYNC_RATE_LIMITED', 'A sync was requested less than 5 minutes ago', wait);
      }
      source.lastSyncRequestedAt = now;
      s.afterCommit(() => this.ctx.trigger.request(source.id));
    });
  }

  acceptSuggestions(user: UserRow, sourceId: string): Promise<AcceptSuggestionsResponseT> {
    return inSession(this.deps.db, async (s) => {
      this.requireDriveAvailable();
      const source = await this.owned(s, user, sourceId);
      const all = await filesOfSource(s, sourceId);
      const byDriveId = new Map<string, DriveFile>();
      for (const f of all) byDriveId.set(f.driveId, f);
      const ordered = all.map((f) => ({ f, d: depth(f, byDriveId) })).sort((a, b) => a.d - b.d).map((x) => x.f);
      let applied = 0;
      for (const f of ordered) {
        if (f.suggestedSubjectId == null || isRemovedFromDrive(f) || f.subjectId != null) continue;
        f.subjectId = f.suggestedSubjectId;
        applied++;
      }
      await this.recalculator.recompute(s, source, all);
      return { applied };
    });
  }

  updateFile(user: UserRow, fileId: string, req: UpdateFileRequest): Promise<TreeItemResponse> {
    return inSession(this.deps.db, async (s) => {
      this.requireDriveAvailable();
      const file = await s.fileById(fileId);
      if (!file) throw fileNotFound(fileId);
      const source = await this.owned(s, user, file.sourceId);
      if (req.subjectId != null) {
        const subjectId = req.subjectId.trim();
        if (subjectId === '') file.subjectId = null;
        else {
          if (!(await repo.subjectExists(s, subjectId))) throw new ValidationError('subjectId', subjectId, 'unknown subject');
          file.subjectId = subjectId;
        }
      }
      if (req.hidden != null) setHiddenByUser(file, req.hidden);
      const node = req.academicYear;
      if (node !== ABSENT && node !== undefined) {
        if (node !== null && !canConvertToInt(node)) throw new ValidationError('academicYear', jsonNodeString(node), 'must be a year or null');
        const year = node === null ? null : Math.trunc(node as number);
        const current = yearInZone(this.deps.clock.now());
        if (year != null && (year < 1990 || year > current)) throw new ValidationError('academicYear', year, `must be between 1990 and ${current}`);
        file.academicYearUser = year;
      }
      const all = await filesOfSource(s, source.id);
      await this.recalculator.recompute(s, source, all);
      const idByDriveId = new Map<string, string>();
      for (const f of all) idByDriveId.set(f.driveId, f.id);
      const names = await views.subjectNames(s, [file.subjectId, file.effectiveSubjectId, file.suggestedSubjectId]);
      return views.treeItem(file, idByDriveId, names, new Set(await planSubjectIds(s, user.id)));
    });
  }
}

/** JsonNode.canConvertToInt: a number within int range (DoubleNode truncates). */
function canConvertToInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= -2147483648 && v <= 2147483647;
}

/** JsonNode.toString() */
function jsonNodeString(v: unknown): string {
  return JSON.stringify(v);
}

