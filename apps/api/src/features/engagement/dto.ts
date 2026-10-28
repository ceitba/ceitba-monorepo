// Request schemas and response shapes of web/engagement (docs/NEWSLETTER-ENGAGEMENT.md).

import type { z } from 'zod';
import { jv } from '../../http/validation';
import { javaIsBlank } from '../../lib/javaCompat';

export const COMMENT_MAX = 1000;
export const RESULTS_VISIBILITIES = ['after_vote', 'after_close'] as const;
export type ResultsVisibility = (typeof RESULTS_VISIBILITIES)[number];

// ---------------------------------------------------------------- comments

export const CreateCommentRequest = jv.object({
  body: jv.string({ notBlank: true, size: { max: COMMENT_MAX } }),
  parentId: jv.uuid(),
});
export type CreateCommentRequest = NonNullable<z.output<typeof CreateCommentRequest>>;

export const ReportCommentRequest = jv.object({
  reason: jv.string({ size: { max: 500 } }),
});
export type ReportCommentRequest = NonNullable<z.output<typeof ReportCommentRequest>>;

export const PinCommentRequest = jv.object({
  pinned: jv.bool({ notNull: true }),
});
export type PinCommentRequest = NonNullable<z.output<typeof PinCommentRequest>>;

export const CommentSettingsRequest = jv.object({
  enabled: jv.bool({ notNull: true }),
});
export type CommentSettingsRequest = NonNullable<z.output<typeof CommentSettingsRequest>>;

export interface CommentResponse {
  id: string;
  parentId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  authorRole: 'author' | null;
  body: string;
  createdAt: string;
  likes: number;
  likedByMe: boolean;
  mine: boolean;
  pinned: boolean;
  deleted: boolean;
  hidden: boolean;
  replies: CommentResponse[];
}

export interface CommentThreadResponse {
  enabled: boolean;
  canModerate: boolean;
  total: number;
  comments: CommentResponse[];
}

export interface LikeResponse { likes: number; likedByMe: boolean }

export interface CommentSettingsResponse { enabled: boolean }

// ---------------------------------------------------------------- polls

const optionLabels = (notNull: boolean) =>
  jv.list(jv.string({ notBlank: true, size: { max: 120 } }), { notNull, size: { min: 2, max: 6 } });
/** In a PATCH: absent leaves it, present must not be blank. */
const notBlankIfPresent = (v: string) => (javaIsBlank(v) ? 'must not be blank' : null);

export const CreatePollRequest = jv.object({
  question: jv.string({ notBlank: true, size: { max: 300 } }),
  options: optionLabels(true),
  resultsVisibility: jv.enum(RESULTS_VISIBILITIES),
  closesAt: jv.instant(),
});
export type CreatePollRequest = NonNullable<z.output<typeof CreatePollRequest>>;

/** null leaves a field as it is; `close` sets closesAt to now, `reopen` clears it. */
export const UpdatePollRequest = jv.object({
  question: jv.string({ size: { max: 300 }, check: notBlankIfPresent }),
  options: optionLabels(false),
  resultsVisibility: jv.enum(RESULTS_VISIBILITIES),
  closesAt: jv.instant(),
  close: jv.bool({ primitive: true }),
  reopen: jv.bool({ primitive: true }),
});
export type UpdatePollRequest = NonNullable<z.output<typeof UpdatePollRequest>>;

export const PollVoteRequest = jv.object({
  optionId: jv.uuid({ notNull: true }),
});
export type PollVoteRequest = NonNullable<z.output<typeof PollVoteRequest>>;

export interface PollOptionResponse { id: string; label: string; votes: number | null }

export interface PollResponse {
  id: string;
  question: string;
  options: PollOptionResponse[];
  resultsVisibility: ResultsVisibility;
  closesAt: string | null;
  closed: boolean;
  totalVotes: number | null;
  myVote: string | null;
  resultsVisible: boolean;
  canEdit: boolean;
}
