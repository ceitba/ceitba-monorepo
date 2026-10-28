// Who may read and manage an article's comments and polls
// (docs/NEWSLETTER-ENGAGEMENT.md "Who can do what").

import type { Db } from '../../db/client';
import { ResourceNotFoundError } from '../../http/errors';
import { formatOffsetDateTime, parsePgTimestamp, systemNowMicros, toPgTimestamp } from '../../lib/time';
import type { OrganizationMembershipService } from '../news/memberships';
import { EngagementConflictError } from './errors';
import * as repo from './repo';

/** The caller: `isStaff` comes from staffPowers(c), so a key without the staff scope is not STAFF. */
export interface Viewer {
  userId: string | null;
  isStaff: boolean;
}

export interface ArticleAccess {
  article: repo.ArticleGateRow;
  /** Delete any comment, pin, restore, turn comments on/off. */
  canModerate: boolean;
  /** Create, edit and delete polls; always see results. */
  canEditPolls: boolean;
}

/** A timestamp read from the database, as the API prints it (UTC, `...Z`). */
export const dbInstant = (pg: string): string => formatOffsetDateTime(parsePgTimestamp(pg));

/** A row timestamp (created_at and the like) for now. */
export const rowNow = (): string => toPgTimestamp(systemNowMicros());

/** Per-user quota shared by comment likes and poll votes (rate-limit user rule). */
export const REACTION_RATE_RULE = 'article-reactions';

/** Readers react only to published articles; editors' drafts gather no comments, likes or votes. */
export function requirePublished(access: ArticleAccess): void {
  if (access.article.status !== 'published') throw new EngagementConflictError('ARTICLE_NOT_PUBLISHED');
}

export class ArticleGate {
  constructor(private readonly memberships: OrganizationMembershipService) {}

  /** The article as `viewer` may see it; 404 when it doesn't exist or is a draft they can't read. */
  async load(tx: Db, articleId: string, viewer: Viewer, forUpdate = false): Promise<ArticleAccess> {
    const article = await repo.findArticle(tx, articleId, forUpdate);
    if (!article) throw new ResourceNotFoundError('Article', articleId);
    const member = article.organization !== null && await this.memberships.userBelongsTo(viewer.userId, article.organization, tx);
    const ownIndependent = article.organization === null && viewer.userId !== null && article.createdBy === viewer.userId;
    const published = article.status === 'published';
    if (!published && !(viewer.isStaff || member || ownIndependent)) throw new ResourceNotFoundError('Article', articleId);
    const canModerate = viewer.isStaff || member;
    return { article, canModerate, canEditPolls: canModerate || (ownIndependent && !published) };
  }
}
