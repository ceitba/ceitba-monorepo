// service/news/ArticleService + the entity-building half of web/news/ArticleController.

import type { Db } from '../../db/client';
import { withTx } from '../../db/client';
import type { Deps } from '../../deps';
import { InvalidStateError, ResourceAlreadyExistsError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { javaIsBlank } from '../../lib/javaCompat';
import { formatOffsetDateTime, systemNowMicros, toPgTimestamp } from '../../lib/time';
import type { ArticleResponse } from './dto';
import type { OrganizationMembershipService } from './memberships';
import { dbTime } from './memberships';
import { pageResponse, type PageRequest, type PageResponse } from './paging';
import { firePushes, type PushTrigger } from './pushTriggers';
import { orgPush } from './pushes';
import * as repo from './repo';

export const PENDING_REVIEW = 'pending_review';
const AUTHOR_STATUSES = new Set(['draft', PENDING_REVIEW]);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** ArticleService.requireAuthorStatus */
export function requireAuthorStatus(status: string | null, defaultWhenMissing: boolean): string | null {
  if (status === null) return defaultWhenMissing ? PENDING_REVIEW : null;
  if (!AUTHOR_STATUSES.has(status)) {
    throw new ValidationError('status', status, "independent articles can only be 'draft' or 'pending_review' until staff publish them");
  }
  return status;
}

/**
 * The Article entity in memory: a row plus how its timestamps print (a value
 * Java computed is in the JVM zone; one Hibernate read is UTC).
 */
export interface ArticleEntity {
  row: repo.ArticleRow;
  createdAtText: string | null;
  updatedAtText: string | null;
}

export function fromRow(row: repo.ArticleRow): ArticleEntity {
  return { row, createdAtText: dbTime(row.createdAt), updatedAtText: dbTime(row.updatedAt) };
}

export function articleResponse(e: ArticleEntity): ArticleResponse {
  const a = e.row;
  return {
    id: a.id, title: a.title, excerpt: a.excerpt, body: a.body as string[], category: a.category,
    organization: a.organization, authors: a.authors as string[], publishedAt: a.publishedAt, readingTime: a.readingTime,
    featured: a.featured ?? false, colorScheme: a.colorScheme, coverImage: a.coverImage, status: a.status,
    createdAt: e.createdAtText, updatedAt: e.updatedAtText,
  };
}

/** The fields ArticleController copies from the request into a new Article. */
export interface NewArticle {
  id: string | null;
  title: string;
  excerpt: string;
  body: (string | null)[];
  category: string;
  authors: (string | null)[];
  publishedAt: string | null;
  readingTime: string | null;
  featured: boolean;
  colorScheme: string | null;
  coverImage: string | null;
  status: string;
}

/** The patch (null = unchanged). */
export interface ArticlePatch {
  title: string | null;
  excerpt: string | null;
  body: (string | null)[] | null;
  category: string | null;
  authors: (string | null)[] | null;
  publishedAt: string | null;
  readingTime: string | null;
  colorScheme: string | null;
  coverImage: string | null;
  status: string | null;
}

export class ArticleService {
  constructor(private readonly deps: Deps, private readonly memberships: OrganizationMembershipService) {}

  private zone() {
    return this.deps.config.server.timeZone;
  }

  findAll(category: string | null, organization: string | null, status: string | null, createdBy: string | null, page: PageRequest): Promise<PageResponse<ArticleResponse>> {
    return withTx(this.deps.db, async (tx) => {
      const { rows, total } = await repo.findArticles(tx, { category, organization, status, createdBy }, page);
      return pageResponse(rows.map((r) => articleResponse(fromRow(r))), page, total);
    }, { readOnly: true });
  }

  findOwnIndependent(category: string | null, status: string | null, createdBy: string, page: PageRequest): Promise<PageResponse<ArticleResponse>> {
    return withTx(this.deps.db, async (tx) => {
      const { rows, total } = await repo.findArticles(tx, { category, organization: null, status, createdBy, independentOnly: true }, page);
      return pageResponse(rows.map((r) => articleResponse(fromRow(r))), page, total);
    }, { readOnly: true });
  }

  /** GET /v1/articles/{id}: findById as the response. */
  getById(id: string, includesDrafts: boolean): Promise<ArticleResponse> {
    return withTx(this.deps.db, async (tx) => articleResponse(fromRow(await this.findById(id, includesDrafts, tx))), { readOnly: true });
  }

  /** findById(id, includesDrafts). */
  async findById(id: string, includesDrafts: boolean, tx?: Db): Promise<repo.ArticleRow> {
    const a = await withTx(tx ?? this.deps.db, (t) => repo.findArticle(t, id), { readOnly: true });
    if (!a || (!includesDrafts && a.status !== 'published')) throw new ResourceNotFoundError('Article', id);
    return a;
  }

  async create(input: NewArticle, organizationSlug: string | null, createdBy: string): Promise<ArticleResponse> {
    const pushes: PushTrigger[] = [];
    const createdAt = systemNowMicros(); // new Article(): OffsetDateTime.now()
    const saved = await withTx(this.deps.db, async (tx) => {
        let id = input.id;
        if (id === null || javaIsBlank(id)) id = crypto.randomUUID();
        else if (!ID_PATTERN.test(id)) {
          throw new ValidationError('id', id, "must be 1-100 lowercase letters, digits or '-', starting with a letter or digit");
        } else if (await repo.articleExists(tx, id)) throw new ResourceAlreadyExistsError('Article', id);
        const org = await this.resolveOrganization(tx, organizationSlug);
        const row: repo.ArticleRow = {
          id, title: input.title, excerpt: input.excerpt, body: input.body, category: input.category, organization: org,
          authors: input.authors, publishedAt: input.publishedAt, readingTime: input.readingTime, featured: input.featured,
          colorScheme: input.colorScheme ?? 'blue', coverImage: input.coverImage, status: input.status,
          createdAt: toPgTimestamp(createdAt), updatedAt: null, pushSentAt: null, createdBy,
        };
        this.dateIfPublished(row);
        await this.notifyFollowersOnce(tx, row, pushes);
        const updatedAt = systemNowMicros(); // @UpdateTimestamp at flush
        row.updatedAt = toPgTimestamp(updatedAt);
        await repo.insertArticle(tx, row);
        return { row, createdAtText: formatOffsetDateTime(createdAt, this.zone()), updatedAtText: formatOffsetDateTime(updatedAt, this.zone()) };
      });
    await this.fire(pushes);
    return articleResponse(saved);
  }

  async update(id: string, patch: ArticlePatch, featured: boolean | null, organizationSlug: string | null,
    independentAuthor: string | null, clearPublishedAt: boolean, expectedStatus: string | null): Promise<ArticleResponse> {
    const pushes: PushTrigger[] = [];
    const saved = await withTx(this.deps.db, async (tx) => {
      const a = await this.lockedForWrite(tx, id, independentAuthor);
      if (expectedStatus !== null && expectedStatus !== a.status) {
        throw new InvalidStateError(`Article ${id} is ${a.status}, not ${expectedStatus}`);
      }
      if (patch.title !== null) a.title = patch.title;
      if (patch.excerpt !== null) a.excerpt = patch.excerpt;
      if (patch.body !== null) a.body = patch.body;
      if (patch.category !== null) a.category = patch.category;
      if (patch.authors !== null) a.authors = patch.authors;
      if (patch.publishedAt !== null) a.publishedAt = patch.publishedAt;
      else if (clearPublishedAt) a.publishedAt = null;
      if (patch.readingTime !== null) a.readingTime = patch.readingTime;
      if (patch.colorScheme !== null) a.colorScheme = patch.colorScheme;
      if (patch.coverImage !== null) a.coverImage = patch.coverImage;
      if (patch.status !== null) a.status = patch.status;
      if (featured !== null) a.featured = featured;
      if (organizationSlug !== null) {
        const org = await this.resolveOrganization(tx, organizationSlug);
        if (org !== null) a.organization = org;
      }
      this.dateIfPublished(a);
      await this.notifyFollowersOnce(tx, a, pushes);
      const updatedAt = systemNowMicros();
      a.updatedAt = toPgTimestamp(updatedAt);
      await repo.updateArticle(tx, a);
      return { row: a, createdAtText: dbTime(a.createdAt), updatedAtText: formatOffsetDateTime(updatedAt, this.zone()) };
    });
    await this.fire(pushes);
    return articleResponse(saved);
  }

  delete(id: string, independentAuthor: string | null): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      await this.lockedForWrite(tx, id, independentAuthor);
      await repo.deleteArticle(tx, id);
    });
  }

  deleteAsOrgMember(id: string, memberId: string | null): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const a = await repo.findArticle(tx, id, true);
      if (!a) throw new ResourceNotFoundError('Article', id);
      if (a.organization === null || !(await this.memberships.userBelongsTo(memberId, a.organization, tx))) {
        throw new InvalidStateError(`Article ${id} no longer belongs to one of your organizations`);
      }
      await repo.deleteArticle(tx, id);
    });
  }

  private async lockedForWrite(tx: Db, id: string, independentAuthor: string | null): Promise<repo.ArticleRow> {
    const a = await repo.findArticle(tx, id, true);
    if (!a) throw new ResourceNotFoundError('Article', id);
    if (independentAuthor !== null) {
      const stillEditable = a.organization === null && a.createdBy !== null && a.createdBy === independentAuthor && a.status !== 'published';
      if (!stillEditable) throw new InvalidStateError(`Article ${id} is no longer an unpublished independent article of yours`);
    }
    return a;
  }

  /** One push per article, the first time it is published (push_sent_at). */
  private async notifyFollowersOnce(tx: Db, a: repo.ArticleRow, pushes: PushTrigger[]) {
    if (a.status !== 'published' || a.pushSentAt !== null) return;
    a.pushSentAt = toPgTimestamp(this.deps.clock.now());
    const org = a.organization === null ? null : await repo.findOrg(tx, a.organization);
    const t = orgPush(org, a.title, 'article', a.id);
    if (t) pushes.push(t);
  }

  private dateIfPublished(a: repo.ArticleRow) {
    if (a.status === 'published' && a.publishedAt === null) a.publishedAt = this.deps.clock.today();
  }

  private async resolveOrganization(tx: Db, slug: string | null): Promise<string | null> {
    if (slug === null || javaIsBlank(slug)) return null;
    const o = await repo.findOrg(tx, slug);
    if (!o) throw new ResourceNotFoundError('Organization', slug);
    return o.slug;
  }

  private async fire(pushes: PushTrigger[]) {
    firePushes(this.deps, pushes);
  }
}
