// Shapes of the CEITBA-API resources the newsletter uses, from the DTO
// records in apps/api (web/news/dto, web/digest/dto/DigestDtos,
// service/analytics/AnalyticsService.Summary). LocalDate / LocalTime travel
// as "YYYY-MM-DD" / "HH:mm[:ss]" strings (parse dates with utils/dates),
// OffsetDateTime as ISO-8601 strings, UUIDs as strings.

export type IsoDate = string
export type IsoTime = string
export type IsoDateTime = string

// ── Paging ──────────────────────────────────────────────────────────────────

export interface PageMeta {
  total: number
  page: number
  limit: number
}

export interface Page<T> {
  data: T[]
  meta: PageMeta
}

// ── Articles ────────────────────────────────────────────────────────────────

export type ArticleStatus = 'draft' | 'pending_review' | 'changes_requested' | 'published' | 'rejected' | (string & {})

// ArticleResponse.
export interface ArticleResponse {
  id: string
  title: string
  excerpt: string | null
  // Markdown blocks.
  body: string[]
  category: string
  // Organization slug, null for independent articles.
  organization: string | null
  authors: string[]
  publishedAt: IsoDate | null
  readingTime: string | null
  featured: boolean
  colorScheme: string | null
  coverImage: string | null
  status: ArticleStatus
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

// What api/articles returns: the response plus `date` (= publishedAt).
// `publishedAt ?? date` leaves it undefined (not null) for unpublished ones.
export interface Article extends ArticleResponse {
  date?: IsoDate | null
}

// ArticleInput / ArticlePatchInput, as the admin form sends them (`date`
// becomes publishedAt in api/articles).
export interface ArticleInput {
  id?: string
  title?: string
  excerpt?: string | null
  body?: string[]
  category?: string
  organization?: string | null
  authors?: string[]
  date?: IsoDate | null
  readingTime?: string | null
  featured?: boolean
  colorScheme?: string | null
  coverImage?: string | null
  status?: ArticleStatus
}

// ── Events ──────────────────────────────────────────────────────────────────

// NewsEventResponse.
export interface NewsEventResponse {
  id: string
  title: string
  eventDate: IsoDate
  startTime: IsoTime | null
  endTime: IsoTime | null
  location: string | null
  category: string
  organization: string | null
  description: string | null
  createdAt: IsoDateTime
}

// What api/events returns: the response plus `date` (= eventDate) and
// `time` (= startTime; `startTime ?? time` leaves it undefined, not null,
// when the event has no start time).
export interface NewsEvent extends NewsEventResponse {
  date: IsoDate
  time?: IsoTime | null
}

// NewsEventInput / NewsEventPatchInput, as the admin form sends them.
export interface NewsEventInput {
  id?: string
  title?: string
  date?: IsoDate
  time?: IsoTime | null
  endTime?: IsoTime | null
  location?: string | null
  category?: string
  organization?: string | null
  description?: string | null
}

// ── Organizations and follows ───────────────────────────────────────────────

// OrganizationResponse.
export interface Organization {
  slug: string
  name: string
  fullName: string | null
  description: string | null
  category: string | null
  color: string | null
  followerCount: number
  logoUrl: string | null
  backgroundUrl: string | null
}

// OrganizationRequest / OrganizationPatchRequest.
export type OrganizationInput = Partial<Omit<Organization, 'followerCount'>>

// MeFollowsController.FollowResponse (GET /me/follows).
export interface Follow {
  orgSlug: string
  createdAt: IsoDateTime
}

// FollowerResponse.
export interface Follower {
  userId: string
  name: string | null
  email: string
  avatarUrl: string | null
  followedAt: IsoDateTime
}

// ── Votes ───────────────────────────────────────────────────────────────────

export type VoteType = 'up' | 'down'

// VoteResponse.
export interface VoteCounts {
  up: number
  down: number
}

// ── Analytics ───────────────────────────────────────────────────────────────

// AnalyticsEventBatch.EventDto (only type and sessionId are required).
export interface AnalyticsEvent {
  type: string
  sessionId: string
  timestamp?: number | null
  articleId?: string | null
  category?: string | null
  path?: string | null
}

// AnalyticsService.Summary.
export interface AnalyticsSummary {
  totalArticleViews: number
  uniqueVisitors: number
  topArticles: { articleId: string; title: string; views: number }[]
  categoryViews: { category: string; views: number }[]
  dailyViews: { date: string; views: number }[]
  voteBreakdown: { articleId: string; title: string; up: number; down: number }[]
}

// ── Weekly digest ("La semana en ITBA") ─────────────────────────────────────

export type DigestStatus = 'draft' | 'sending' | 'sent' | 'cancelled'

export interface DigestCounts {
  pending: number
  sent: number
  failed: number
}

export interface DigestOrgRef {
  slug: string
  name: string
}

// DigestDtos.Summary.
export interface DigestSummary {
  id: string
  weekStart: IsoDate
  weekEnd: IsoDate
  subject: string
  status: DigestStatus
  autoSendAt: IsoDateTime | null
  sentAt: IsoDateTime | null
  createdAt: IsoDateTime
  counts: DigestCounts
  resumeAt: IsoDateTime | null
  estimatedFinishAt: IsoDateTime | null
  openRate: number | null
  clickRate: number | null
}

// DigestDtos.ArticleItem / EventItem.
export interface DigestArticleItem {
  id: string
  title: string
  excerpt: string | null
  coverImage: string | null
  publishedAt: IsoDate | null
  organization: DigestOrgRef | null
  excluded: boolean
}

export interface DigestEventItem {
  id: string
  title: string
  eventDate: IsoDate
  startTime: IsoTime | null
  endTime: IsoTime | null
  location: string | null
  organization: DigestOrgRef | null
  excluded: boolean
}

// DigestDtos.Detail.
export interface DigestDetail {
  id: string
  weekStart: IsoDate
  weekEnd: IsoDate
  subject: string
  intro: string | null
  status: DigestStatus
  autoSendAt: IsoDateTime | null
  sentAt: IsoDateTime | null
  counts: DigestCounts
  recipientEstimate: number | null
  articles: DigestArticleItem[]
  events: DigestEventItem[]
  resumeAt: IsoDateTime | null
  estimatedFinishAt: IsoDateTime | null
}

// DigestDtos.Quota.
export interface DigestQuota {
  account: string | null
  limit: number
  usedLast24h: number
  remaining: number
  pausedUntil: IsoDateTime | null
  pauseReason: string | null
  nextCapacityAt: IsoDateTime | null
  senderStatus: string | null
}

// DigestDtos.Stats.
export interface DigestStats {
  delivered: number
  uniqueOpens: number
  openRate: number | null
  uniqueClicks: number
  clickRate: number | null
  clicksByLink: { label: string; url: string; uniqueClicks: number; totalClicks: number }[]
  opensByHour: { hour: IsoDateTime; count: number }[]
}

// DigestDtos.PatchRequest. Absent = unchanged; intro / autoSendAt null =
// clear (autoSendAt null turns auto-send off).
export interface DigestPatch {
  subject?: string
  intro?: string | null
  excludedArticleIds?: string[]
  excludedEventIds?: string[]
  autoSendAt?: IsoDateTime | null
}

// DigestDtos.TestSendResponse.
export interface DigestTestSendResult {
  sentTo: string
}

// DigestDtos.Slot / CorrectionVoteView / CorrectionVoteResult: the
// "¿Es así?" schedule-correction votes linked from the digest.
export interface DigestSlot {
  day: string
  from: string
  to: string
}

// What the reader sends (POST /digests/correction-vote; the API lowercases it).
export type CorrectionVote = 'confirm' | 'reject'

// How a stored vote comes back (the enum name): myVote / previousVote.
export type CorrectionVoteValue = 'CONFIRM' | 'REJECT' | (string & {})

export interface CorrectionVoteView {
  correctionId: string
  subjectId: string
  subjectName: string
  commissionName: string
  status: string
  open: boolean
  proposed: DigestSlot[]
  sga: DigestSlot[]
  confirms: number
  rejects: number
  myVote: CorrectionVoteValue | null
  expiresAt: IsoDateTime | null
}

export interface CorrectionVoteResult {
  correction: CorrectionVoteView
  previousVote: CorrectionVoteValue | null
}

// ── Media uploads ───────────────────────────────────────────────────────────

// SignUploadResponse (POST /media/sign-upload).
export interface SignUploadResponse {
  uploadUrl: string
  publicUrl: string
  key: string
  method: string | null
  headers: Record<string, string> | null
  expiresAt: IsoDateTime
}

// ── Mail sender accounts (web/mail) ─────────────────────────────────────────

// MailAccountController.ConnectResponse.
export interface MailConnectResponse {
  authorizationUrl: string
}

// MailSenderAccountService.AccountView.
export interface SenderAccount {
  id: number
  email: string
  ownerType: 'ceitba' | 'organization' | (string & {})
  ownerRef: string | null
  status: 'connected' | 'broken' | 'revoked' | (string & {})
  connectedAt: IsoDateTime | null
  lastError: string | null
  lastUsedAt: IsoDateTime | null
}
