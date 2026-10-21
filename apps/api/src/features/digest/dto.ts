// web/digest/dto/DigestDtos: request schemas and response shapes (record order).

import { z } from 'zod';
import { jv } from '../../http/validation';

/** Jackson's NullNode: an explicit `null` for a JsonNode field (absent binds to Java null). */
export const NULL_NODE = Object.freeze({ nullNode: true as const });
export type JsonNodeValue = typeof NULL_NODE | string | number | boolean | object | unknown[] | null;
const jsonNode = () => z.any().transform((v: unknown): JsonNodeValue => (v === undefined ? null : v === null ? NULL_NODE : v as JsonNodeValue));

// CreateRequest(@NotNull LocalDate weekStart, String autoSendAt)
export const CreateRequest = jv.object({
  weekStart: jv.localDate({ notNull: true }),
  autoSendAt: jv.string(),
});
export type CreateRequest = NonNullable<z.output<typeof CreateRequest>>;

// PatchRequest(@Size(max=200) String subject, JsonNode intro, @Size(max=500) List<String> excludedArticleIds,
//              @Size(max=500) List<String> excludedEventIds, JsonNode autoSendAt)
export const PatchRequest = jv.object({
  subject: jv.string({ size: { max: 200 } }),
  intro: jsonNode(),
  excludedArticleIds: jv.list(jv.string(), { size: { max: 500 } }),
  excludedEventIds: jv.list(jv.string(), { size: { max: 500 } }),
  autoSendAt: jsonNode(),
});
export type PatchRequest = NonNullable<z.output<typeof PatchRequest>>;

// Subscription(@NotNull Boolean enabled)
export const SubscriptionRequest = jv.object({ enabled: jv.bool({ notNull: true }) });

// CorrectionVoteRequest(@NotNull @Size(max = 200) String token, @NotNull String vote)
export const CorrectionVoteRequest = jv.object({
  token: jv.string({ notNull: true, size: { max: 200 } }),
  vote: jv.string({ notNull: true }),
});

export interface Counts { pending: number; sent: number; failed: number }
export interface OrgRef { slug: string; name: string }

export interface Summary {
  id: string; weekStart: string; weekEnd: string; subject: string; status: string;
  autoSendAt: string | null; sentAt: string | null; createdAt: string | null; counts: Counts;
  resumeAt: string | null; estimatedFinishAt: string | null; openRate: unknown; clickRate: unknown;
}

export interface ArticleItem {
  id: string; title: string; excerpt: string | null; coverImage: string | null; publishedAt: string | null;
  organization: OrgRef | null; excluded: boolean;
}

export interface EventItem {
  id: string; title: string; eventDate: string; startTime: string | null; endTime: string | null;
  location: string | null; organization: OrgRef | null; excluded: boolean;
}

export interface Detail {
  id: string; weekStart: string; weekEnd: string; subject: string; intro: string | null; status: string;
  autoSendAt: string | null; sentAt: string | null; counts: Counts; recipientEstimate: number | null;
  articles: ArticleItem[]; events: EventItem[]; resumeAt: string | null; estimatedFinishAt: string | null;
}

export interface Quota {
  account: string; limit: number; usedLast24h: number; remaining: number; pausedUntil: string | null;
  pauseReason: string | null; nextCapacityAt: string | null; senderStatus: string | null;
}

export interface LinkClicks { label: string; url: string; uniqueClicks: number; totalClicks: number }
export interface HourCount { hour: string; count: number }
export interface Stats {
  delivered: number; uniqueOpens: number; openRate: unknown; uniqueClicks: number; clickRate: unknown;
  clicksByLink: LinkClicks[]; opensByHour: HourCount[];
}

export interface Slot { day: string; from: string; to: string }
export interface CorrectionVoteView {
  correctionId: string; subjectId: string; subjectName: string; commissionName: string; status: string; open: boolean;
  proposed: Slot[]; sga: Slot[]; confirms: number; rejects: number; myVote: string | null; expiresAt: string;
}
export interface CorrectionVoteResult { correction: CorrectionVoteView; previousVote: string | null }
