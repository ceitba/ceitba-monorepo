// Article comments: threads, likes, reports and moderation (docs/NEWSLETTER-ENGAGEMENT.md "Comments").

import { withTx, type Db } from '../../db/client';
import type { Deps } from '../../deps';
import { AccessDeniedError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import type {
  CommentResponse, CommentSettingsResponse, CommentThreadResponse, CreateCommentRequest, LikeResponse, ReportCommentRequest,
} from './dto';
import { EngagementConflictError } from './errors';
import { REACTION_RATE_RULE, dbInstant, requirePublished, rowNow, type ArticleAccess, type ArticleGate, type Viewer } from './gate';
import * as repo from './repo';

/** Reports that hide a comment until an editor restores it. */
export const REPORT_THRESHOLD = 3;
/** Per-user quotas (rate-limit user rules); likes use REACTION_RATE_RULE with poll votes. */
const COMMENT_RATE_RULE = 'article-comments';
const REPORT_RATE_RULE = 'article-comment-reports';

export class CommentService {
  constructor(private readonly deps: Deps, private readonly gate: ArticleGate) {}

  thread(articleId: string, viewer: Viewer, sort: 'top' | 'new'): Promise<CommentThreadResponse> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.gate.load(tx, articleId, viewer);
      const all = await repo.listComments(tx, articleId, viewer.userId, sort === 'top');
      const visible = (r: repo.CommentViewRow) => r.hiddenAt === null || access.canModerate;
      const replies = new Map<string, repo.CommentViewRow[]>();
      for (const r of all) {
        if (r.parentId !== null && r.deletedAt === null && visible(r)) replies.set(r.parentId, [...(replies.get(r.parentId) ?? []), r]);
      }
      let total = 0;
      const comments: CommentResponse[] = [];
      for (const r of all) {
        if (r.parentId !== null || !visible(r)) continue;
        const own = (replies.get(r.id) ?? []).map((x) => toResponse(x, viewer, []));
        if (r.deletedAt !== null && own.length === 0) continue;
        total += own.length + (r.deletedAt === null ? 1 : 0);
        comments.push(toResponse(r, viewer, own));
      }
      return { enabled: access.article.commentsEnabled, canModerate: access.canModerate, total, comments };
    }, { readOnly: true });
  }

  create(articleId: string, viewer: Viewer, req: CreateCommentRequest): Promise<CommentResponse> {
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
      this.deps.userRateLimiter.consume(COMMENT_RATE_RULE, viewer.userId!);
      const id = crypto.randomUUID();
      await repo.insertComment(tx, { id, articleId, userId: viewer.userId!, parentId: req.parentId, body: javaTrim(req.body!), createdAt: rowNow() });
      return this.view(tx, id, viewer);
    });
  }

  delete(articleId: string, commentId: string, viewer: Viewer): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.gate.load(tx, articleId, viewer);
      const c = await this.requireComment(tx, access, articleId, commentId, true);
      if (c.userId !== viewer.userId && !access.canModerate) throw new AccessDeniedError();
      await repo.softDeleteComment(tx, commentId, rowNow());
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
        await repo.likeComment(tx, commentId, viewer.userId!, rowNow());
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
      if (c.userId === viewer.userId) throw new ValidationError('commentId', commentId, 'you cannot report your own comment');
      this.deps.userRateLimiter.consume(REPORT_RATE_RULE, viewer.userId!);
      const reason = req.reason == null || javaIsBlank(req.reason) ? null : javaTrim(req.reason);
      const reports = await repo.upsertReport(tx, commentId, viewer.userId!, reason, rowNow());
      if (reports >= REPORT_THRESHOLD && c.hiddenAt === null) await repo.setCommentHidden(tx, commentId, rowNow());
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

function toResponse(r: repo.CommentViewRow, viewer: Viewer, replies: CommentResponse[]): CommentResponse {
  const deleted = r.deletedAt !== null;
  return {
    id: r.id,
    parentId: r.parentId,
    authorName: deleted ? null : r.authorName,
    authorAvatarUrl: deleted ? null : r.authorAvatarUrl,
    authorRole: !deleted && r.isAuthor ? 'author' : null,
    body: deleted ? '' : r.body,
    createdAt: dbInstant(r.createdAt),
    likes: deleted ? 0 : r.likes,
    likedByMe: !deleted && r.liked,
    mine: !deleted && viewer.userId !== null && r.userId === viewer.userId,
    pinned: r.pinned,
    deleted,
    hidden: r.hiddenAt !== null,
    replies,
  };
}
