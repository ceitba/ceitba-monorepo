// service/share/ShareSessionService: group sharing rooms for the scheduler.
//
// Timestamps follow what Hibernate hands Jackson (verified on the jar, see
// contract/tests/share-sessions.contract.test.ts):
//   - rows loaded from the DB print UTC (`...Z`);
//   - a session / participant persisted in THIS transaction keeps its in-memory
//     @CreationTimestamp, in the JVM zone (`...-03:00`): the session and creator
//     on create, the newcomer on join;
//   - a rejoin merges a fresh entity (joinedAt null) onto the managed row, so
//     that participant prints `joinedAt: null` in the join response.

import { randomBytes } from 'node:crypto';
import type { Deps } from '../../deps';
import { withTx, type Tx } from '../../db/client';
import type { UserRow } from '../../http/auth/repo';
import { ResourceNotFoundError, ValidationError } from '../../http/errors';
import { base64UrlEncode, JAVA_S, javaIsBlank, javaSplit, javaTrim } from '../../lib/javaCompat';
import { formatOffsetDateTime, parsePgTimestamp, systemNowMicros, type Micros } from '../../lib/time';
import type { CreateShareSessionRequest, JoinShareSessionRequest, ParticipantResponse, ShareSessionResponse } from './dto';
import { jacksonFromJsonbText, RawJsonText } from '../../lib/jackson';
import * as repo from './repo';

export const MAX_PARTICIPANTS = 50;
const TOKEN_BYTES = 12;
const TOKEN_RETRIES = 5;

/** In-memory values of entities persisted/merged in this transaction. */
interface Fresh {
  sessionCreatedAt?: Micros;
  /** userId -> in-memory joinedAt (null after a merge). */
  joinedAt?: Map<string, Micros | null>;
}

export class ShareSessionService {
  constructor(private readonly deps: Deps) {}

  private get zone(): string {
    return this.deps.config.server.timeZone;
  }

  create(creator: UserRow, req: CreateShareSessionRequest): Promise<ShareSessionResponse> {
    return withTx(this.deps.db, async (tx) => {
      const scheduleId = req.savedScheduleId!;
      if (!(await repo.savedScheduleOwned(tx, scheduleId, creator.id))) throw new ResourceNotFoundError('SavedSchedule', scheduleId);
      const token = await this.generateUniqueToken(tx);
      const createdAt = systemNowMicros();
      const session = await repo.insertSession(tx, token, creator.id, req.name, createdAt);
      const joinedAt = systemNowMicros();
      await repo.insertParticipant(tx, session.id, creator.id, scheduleId, resolveDisplayName(req.displayName, creator), joinedAt);
      return this.toResponse(tx, session, { sessionCreatedAt: createdAt, joinedAt: new Map([[creator.id, joinedAt]]) });
    });
  }

  /** @Transactional(readOnly = true) */
  readByToken(token: string): Promise<ShareSessionResponse> {
    return withTx(this.deps.db, async (tx) => this.toResponse(tx, await this.find(tx, token), {}), { readOnly: true });
  }

  join(user: UserRow, token: string, req: JoinShareSessionRequest): Promise<ShareSessionResponse> {
    return withTx(this.deps.db, async (tx) => {
      const session = await this.find(tx, token);
      const scheduleId = req.savedScheduleId!;
      if (!(await repo.savedScheduleOwned(tx, scheduleId, user.id))) throw new ResourceNotFoundError('SavedSchedule', scheduleId);
      const alreadyJoined = (await repo.participantsOf(tx, session.id)).some((p) => p.userId === user.id);
      if (!alreadyJoined && (await repo.countParticipants(tx, session.id)) >= MAX_PARTICIPANTS) {
        throw new ValidationError('session', token, `Session is full (max ${MAX_PARTICIPANTS} participants).`);
      }
      const displayName = resolveDisplayName(req.displayName, user);
      let joined: Micros | null = null;
      if (alreadyJoined) {
        await repo.updateParticipant(tx, session.id, user.id, scheduleId, displayName);
      } else {
        joined = systemNowMicros();
        await repo.insertParticipant(tx, session.id, user.id, scheduleId, displayName, joined);
      }
      return this.toResponse(tx, session, { joinedAt: new Map([[user.id, joined]]) });
    });
  }

  leave(user: UserRow, token: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const session = await this.find(tx, token);
      if ((await repo.participantsOf(tx, session.id)).some((p) => p.userId === user.id)) {
        await repo.deleteParticipant(tx, session.id, user.id);
      }
    });
  }

  /** 404 for non-creators too: whether a token exists is not leaked. */
  delete(user: UserRow, token: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const session = await repo.findByToken(tx, token);
      if (!session || session.creatorUserId !== user.id) throw new ResourceNotFoundError('ShareSession', token);
      await repo.deleteSession(tx, session.id);
    });
  }

  private async find(tx: Tx, token: string): Promise<repo.SessionRow> {
    const s = await repo.findByToken(tx, token);
    if (!s) throw new ResourceNotFoundError('ShareSession', token);
    return s;
  }

  private async toResponse(tx: Tx, session: repo.SessionRow, fresh: Fresh): Promise<ShareSessionResponse> {
    const rows = await repo.participantsOf(tx, session.id);
    const scheduleById = await repo.schedulesByIds(tx, rows.map((p) => p.savedScheduleId).filter((id): id is string => id !== null));
    const creatorDisplayName = rows.find((p) => p.userId === session.creatorUserId)?.displayName ?? null;
    const dbTime = (pg: string | null) => (pg === null ? null : formatOffsetDateTime(parsePgTimestamp(pg)));
    const participants: ParticipantResponse[] = rows.map((p) => {
      const s = p.savedScheduleId !== null ? scheduleById.get(p.savedScheduleId) : undefined;
      let joinedAt: string | null;
      if (fresh.joinedAt?.has(p.userId)) {
        const us = fresh.joinedAt.get(p.userId)!;
        joinedAt = us === null ? null : formatOffsetDateTime(us, this.zone);
      } else {
        joinedAt = dbTime(p.joinedAt);
      }
      return {
        userId: p.userId,
        displayName: p.displayName,
        isCreator: p.userId === session.creatorUserId,
        careerId: s ? s.careerId : null,
        plan: s ? s.plan : null,
        payload: s ? new RawJsonText(jacksonFromJsonbText(s.payloadText)) : null,
        joinedAt,
      };
    });
    return {
      id: session.id,
      token: session.token,
      name: session.name,
      creatorDisplayName,
      expiresAt: dbTime(session.expiresAt),
      createdAt: fresh.sessionCreatedAt !== undefined ? formatOffsetDateTime(fresh.sessionCreatedAt, this.zone) : dbTime(session.createdAt)!,
      participants,
    };
  }

  private async generateUniqueToken(tx: Tx): Promise<string> {
    for (let i = 0; i < TOKEN_RETRIES; i++) {
      const token = base64UrlEncode(new Uint8Array(randomBytes(TOKEN_BYTES)));
      if (!(await repo.tokenExists(tx, token))) return token;
    }
    throw new Error('Could not allocate a unique share token after retries');
  }
}

/** Requested name, else the first word of the user's name, else the email's local part. */
export function resolveDisplayName(requested: string | null, user: Pick<UserRow, 'name' | 'email'>): string {
  if (requested !== null && !javaIsBlank(requested)) return javaTrim(requested);
  if (user.name !== null && !javaIsBlank(user.name)) return javaSplit(javaTrim(user.name), new RegExp(`${JAVA_S}+`))[0]!;
  const at = user.email.indexOf('@');
  return at > 0 ? user.email.slice(0, at) : user.email;
}
