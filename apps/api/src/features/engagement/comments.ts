// Article comments: threads, likes, reports and moderation (docs/NEWSLETTER-ENGAGEMENT.md "Comments").

import { withTx, type Db } from '../../db/client';
import type { Deps } from '../../deps';
import { AccessDeniedError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { systemNowMicros, toPgTimestamp } from '../../lib/time';
import type {
  CommentResponse, CommentSettingsResponse, CommentThreadResponse, CreateCommentRequest, LikeResponse, ReportCommentRequest,
} from './dto';
import { EngagementConflictError } from './errors';
import { dbInstant, type ArticleAccess, type ArticleGate, type Viewer } from './gate';
import * as repo from './repo';

/** Reports that hide a comment until an editor restores it. */
export const REPORT_THRESHOLD = 3;
/** Per-user quotas (rate-limit user rules). Likes share theirs with poll votes. */
const COMMENT_RATE_RULE = 'article-comments';
const REPORT_RATE_RULE = 'article-comment-reports';
export const REACTION_RATE_RULE = 'article-reactions';

const now = () => toPgTimestamp(systemNowMicros());

export class CommentService {
  constructor(private readonly deps: Deps, private readonly gate: ArticleGate) {}

  thread(articleId: string, viewer: Viewer, sort: 'top' | 'new'): Promise<CommentThreadResponse> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.gate.load(tx, articleId, viewer);
      const all = await repo.listComments(tx, articleId, viewer.userId, sort === 'top');
      const visible = (r: repo.CommentViewRow) => r.hidden_at === null || access.canModerate;
      const replies = new Map<string, repo.CommentViewRow[]>();
      for (const r of all) {
        if (r.parent_id !== null && r.deleted_at === null && visible(r)) replies.set(r.parent_id, [...(replies.get(r.parent_id) ?? []), r]);
      }
      let total = 0;
      const comments: CommentResponse[] = [];
      for (const r of all) {
        if (r.parent_id !== null || !visible(r)) continue;
        const own = (replies.get(r.id) ?? []).map((x) => toResponse(x, viewer, []));
        if (r.deleted_at !== null && own.length === 0) continue;
        total += own.length + (r.deleted_at === null ? 1 : 0);
        comments.push(toResponse(r, viewer, own));
      }
      return { enabled: access.article.commentsEnabled, canModerate: access.canModerate, total, comments };
    }, { readOnly: true });
  }

  create(articleId: string, userId: string, viewer: Viewer, req: CreateCommentRequest): Promise<CommentResponse> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.gate.load(tx, articleId, viewer);
      requirePublished(access);
      if (!access.article.commentsEnabled) throw new EngagementConflictError('COMMENTS_DISABLED');
      if (req.parentId !== null) {
        const parent = await repo.findComment(tx, articleId, req.parentId);
        // A hidden parent only exists for editors, like everywhere else.
        if (!parent || parent.deletedAt !== null || (parent.hiddenAt !== null && !access.canModerate)) {
          throw new ValidationError('parentId', req.parentId, 'must be a comment of this article');
        }
        if (parent.parentId !== null) throw new ValidationError('parentId', req.parentId, 'replies can only answer a top-level comment');
      }
      this.deps.userRateLimiter.consume(COMMENT_RATE_RULE, userId);
      const id = crypto.randomUUID();
      await repo.insertComment(tx, { id, articleId, userId, parentId: req.parentId, body: javaTrim(req.body!), createdAt: now() });
      return this.view(tx, id, viewer);
    });
  }

  delete(articleId: string, commentId: string, viewer: Viewer): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.gate.load(tx, articleId, viewer);
      const c = await this.requireComment(tx, access, articleId, commentId, true);
      if (c.userId !== viewer.userId && !access.canModerate) throw new AccessDeniedError();
      await repo.softDeleteComment(tx, commentId, now());
    });
  }

  like(articleId: string, commentId: string, viewer: Viewer, liked: boolean): Promise<LikeResponse> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.gate.load(tx, articleId, viewer);
      await this.requireComment(tx, access, articleId, commentId);
      if (liked) {
        requirePublished(access);
        if (!access.article.commentsEnabled) throw new EngagementConflictError('COMMENTS_DISABLED');
        this.deps.userRateLimiter.consume(REACTION_RATE_RULE, viewer.userId!);
        await repo.likeComment(tx, commentId, viewer.userId!, now());
      } else {
        await repo.unlikeComment(tx, commentId, viewer.userId!);
      }
      const s = await repo.likeState(tx, commentId, viewer.userId!);
      return { likes: s.likes, likedByMe: s.liked };
    });
  }

  report(articleId: string, commentId: string, viewer: Viewer, req: ReportCommentRequest): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.gate.load(tx, articleId, viewer);
      const c = await this.requireComment(tx, access, articleId, commentId, true);
      this.deps.userRateLimiter.consume(REPORT_RATE_RULE, viewer.userId!);
      const reason = req.reason == null || javaIsBlank(req.reason) ? null : javaTrim(req.reason);
      const reports = await repo.upsertReport(tx, commentId, viewer.userId!, reason, now());
      if (reports >= REPORT_THRESHOLD && c.hiddenAt === null) await repo.setCommentHidden(tx, commentId, now());
    });
  }

  pin(articleId: string, commentId: string, viewer: Viewer, pinned: boolean): Promise<CommentResponse> {
    return withTx(this.deps.db, async (tx) => {
      // The article row lock serializes concurrent pins (one pinned comment per article).
      const access = await this.moderate(tx, articleId, viewer, true);
      const c = await this.requireComment(tx, access, articleId, commentId, true);
      if (pinned && c.parentId !== null) throw new ValidationError('pinned', pinned, 'only top-level comments can be pinned');
      if (pinned) await repo.pinComment(tx, articleId, commentId);
      else await repo.unpinComment(tx, commentId);
      return this.view(tx, commentId, viewer);
    });
  }

  restore(articleId: string, commentId: string, viewer: Viewer): Promise<CommentResponse> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.moderate(tx, articleId, viewer);
      await this.requireComment(tx, access, articleId, commentId, true);
      await repo.setCommentHidden(tx, commentId, null);
      await repo.deleteReports(tx, commentId);
      return this.view(tx, commentId, viewer);
    });
  }

  settings(articleId: string, viewer: Viewer, enabled: boolean): Promise<CommentSettingsResponse> {
    return withTx(this.deps.db, async (tx) => {
      await this.moderate(tx, articleId, viewer, true);
      await repo.setCommentsEnabled(tx, articleId, enabled);
      return { enabled };
    });
  }

  private async moderate(tx: Db, articleId: string, viewer: Viewer, forUpdate = false): Promise<ArticleAccess> {
    const access = await this.gate.load(tx, articleId, viewer, forUpdate);
    if (!access.canModerate) throw new AccessDeniedError();
    return access;
  }

  /** A live comment of the article; a hidden one only exists for editors. */
  private async requireComment(tx: Db, access: ArticleAccess, articleId: string, commentId: string, forUpdate = false): Promise<repo.CommentRow> {
    const c = await repo.findComment(tx, articleId, commentId, forUpdate);
    if (!c || c.deletedAt !== null || (c.hiddenAt !== null && !access.canModerate)) throw new ResourceNotFoundError('Comment', commentId);
    return c;
  }

  private async view(tx: Db, id: string, viewer: Viewer): Promise<CommentResponse> {
    return toResponse((await repo.findCommentView(tx, id, viewer.userId))!, viewer, []);
  }
}

/** Readers react only to published articles; editors' drafts gather no comments, likes or votes. */
export function requirePublished(access: ArticleAccess): void {
  if (access.article.status !== 'published') throw new EngagementConflictError('ARTICLE_NOT_PUBLISHED');
}

function toResponse(r: repo.CommentViewRow, viewer: Viewer, replies: CommentResponse[]): CommentResponse {
  const deleted = r.deleted_at !== null;
  return {
    id: r.id,
    parentId: r.parent_id,
    authorName: deleted ? null : r.author_name,
    authorAvatarUrl: deleted ? null : r.author_avatar_url,
    authorRole: !deleted && r.is_author ? 'author' : null,
    body: deleted ? '' : r.body,
    createdAt: dbInstant(r.created_at),
    likes: deleted ? 0 : r.likes,
    likedByMe: !deleted && r.liked,
    mine: !deleted && viewer.userId !== null && r.user_id === viewer.userId,
    pinned: r.pinned,
    deleted,
    hidden: r.hidden_at !== null,
    replies,
  };
}
