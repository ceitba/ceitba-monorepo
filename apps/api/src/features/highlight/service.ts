// service/highlight/HighlightService.

import { randomUUID } from 'node:crypto';
import type { Deps } from '../../deps';
import { withTx } from '../../db/client';
import { ResourceNotFoundError, ValidationError } from '../../http/errors';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { formatOffsetDateTime, parsePgTimestamp, systemNowMicros, type Micros } from '../../lib/time';
import { offsetDateTimeToString } from '../classroom/logic/javaTimeText';
import type { HighlightRequest, HighlightResponse } from './dto';
import * as repo from './repo';

const fmt = (us: Micros | null) => (us === null ? null : formatOffsetDateTime(us, 'UTC'));
const fromDb = (pg: string | null) => (pg === null ? null : formatOffsetDateTime(parsePgTimestamp(pg)));
const blankToNull = (s: string | null) => (s === null || javaIsBlank(s) ? null : javaTrim(s));

function toResponse(row: repo.HighlightRow): HighlightResponse {
  return {
    id: row.id, title: row.title, description: row.description, imageUrl: row.imageUrl, linkUrl: row.linkUrl,
    position: row.position, startsAt: fromDb(row.startsAt), endsAt: fromDb(row.endsAt), active: row.active,
  };
}

export class HighlightService {
  constructor(private readonly deps: Deps) {}

  listVisible(): Promise<HighlightResponse[]> {
    return withTx(this.deps.db, async (tx) => (await repo.findVisible(tx, this.deps.clock.now())).map(toResponse), { readOnly: true });
  }

  listAll(): Promise<HighlightResponse[]> {
    return withTx(this.deps.db, async (tx) => (await repo.findAllOrdered(tx)).map(toResponse), { readOnly: true });
  }

  create(req: HighlightRequest): Promise<HighlightResponse> {
    const v = this.values(req);
    return withTx(this.deps.db, async (tx) => {
      const id = randomUUID();
      await repo.insert(tx, id, v, systemNowMicros());
      return this.inMemory(id, v);
    });
  }

  update(id: string, req: HighlightRequest): Promise<HighlightResponse> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.findById(tx, id))) throw new ResourceNotFoundError('Highlight', id);
      const v = this.values(req);
      await repo.update(tx, id, v, systemNowMicros());
      return this.inMemory(id, v);
    });
  }

  delete(id: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.exists(tx, id))) throw new ResourceNotFoundError('Highlight', id);
      await repo.remove(tx, id);
    });
  }

  /** The entity after apply(h, req); startsAt must precede endsAt. */
  private values(req: HighlightRequest): repo.HighlightValues {
    if (req.startsAt !== null && req.endsAt !== null && !(req.startsAt < req.endsAt)) {
      throw new ValidationError('startsAt', offsetDateTimeToString(req.startsAt), 'must be before endsAt');
    }
    return {
      title: javaTrim(req.title!),
      description: blankToNull(req.description),
      imageUrl: javaTrim(req.imageUrl!),
      linkUrl: blankToNull(req.linkUrl),
      position: req.position ?? 0,
      startsAt: req.startsAt,
      endsAt: req.endsAt,
      active: req.active === null || req.active,
    };
  }

  /** save() returns the in-memory entity: request OffsetDateTimes as Jackson bound them (UTC). */
  private inMemory(id: string, v: repo.HighlightValues): HighlightResponse {
    return {
      id, title: v.title, description: v.description, imageUrl: v.imageUrl, linkUrl: v.linkUrl,
      position: v.position, startsAt: fmt(v.startsAt), endsAt: fmt(v.endsAt), active: v.active,
    };
  }
}
