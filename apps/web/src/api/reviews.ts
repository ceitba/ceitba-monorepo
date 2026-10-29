import { apiGet, apiSend } from './client'

// Subject reviews ("Opiniones"): short, anonymous reviews of a subject for a
// term and commission. Contract: apps/api/docs/SUBJECT-REVIEWS.md.

export type Period = 1 | 2
export type Difficulty = 1 | 2 | 3

export const REVIEW_REPORT_REASONS = ['OFFENSIVE', 'PERSONAL_DATA', 'FALSE', 'SPAM', 'OTHER'] as const
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number]

// The API refuses more than this many professors on one review.
export const MAX_PROFESSORS_PER_REVIEW = 6
export const MAX_COMMISSION_LENGTH = 20
export const MAX_COMMENT_LENGTH = 2000

// Review-specific `error` codes in the API's {error, message} body.
export type ReviewErrorCode =
  | 'SubjectReviewExists'            // 409: one review per subject and term
  | 'SubjectReviewFutureTerm'        // 400
  | 'SubjectReviewOwn'               // 400: "Me sirvió" or a report on your own review
  | 'SubjectReviewHidden'            // 409: the author deletes their review hidden by reports
  | 'UnknownProfessor'               // 400
  | 'ProfessorEmailDomain'           // 400
  | 'ProfessorNotFound'              // 404
  | 'ProfessorDirectoryUnavailable'  // 503

// A professor as readers see them: the email never leaves the API.
export interface Professor { id: string; name: string }

export interface Review {
  id: string
  year: number
  period: Period
  commission: string
  professorIds: string[]
  recommend: boolean
  difficulty: Difficulty
  comment: string | null
  helpfulCount: number
  // The caller marked it "Me sirvió".
  helpful: boolean
  // The caller reported it.
  reported: boolean
  // The caller wrote it.
  mine: boolean
  // Only ever true on the caller's own review (others' hidden ones aren't listed).
  hidden: boolean
  createdAt: string
  updatedAt: string
}

export interface SubjectReviews {
  subjectId: string
  subjectName: string
  // Newest term first.
  reviews: Review[]
  // Every professor some listed review names.
  professors: Professor[]
}

export interface SaveReviewBody {
  year: number
  period: Period
  commission: string
  recommend: boolean
  difficulty: Difficulty
  professorIds: string[]
  comment: string | null
}

export interface StaffReviewReport { reason: ReviewReportReason; comment: string | null; createdAt: string }

export interface StaffReview {
  id: string
  subjectId: string
  subjectName: string
  year: number
  period: Period
  commission: string
  professors: Professor[]
  recommend: boolean
  difficulty: Difficulty
  comment: string | null
  reportCount: number
  reports: StaffReviewReport[]
  createdAt: string
  updatedAt: string
}

const sub = (subjectId: string) => `/subjects/${encodeURIComponent(subjectId)}/reviews`
const one = (id: string) => `/subject-reviews/${encodeURIComponent(id)}`

export function fetchSubjectReviews(subjectId: string): Promise<SubjectReviews> {
  return apiGet<SubjectReviews>(sub(subjectId))
}

export function createReview(subjectId: string, body: SaveReviewBody): Promise<Review> {
  return apiSend<Review>('POST', sub(subjectId), body)
}

export function updateReview(id: string, body: SaveReviewBody): Promise<Review> {
  return apiSend<Review>('PUT', one(id), body)
}

export function deleteReview(id: string): Promise<void> {
  return apiSend<void>('DELETE', one(id))
}

export function setReviewHelpful(id: string, helpful: boolean): Promise<void> {
  return apiSend<void>(helpful ? 'PUT' : 'DELETE', `${one(id)}/helpful`)
}

export function reportReview(id: string, reason: ReviewReportReason, comment: string): Promise<void> {
  return apiSend<void>('PUT', `${one(id)}/report`, { reason, comment: comment || null })
}

export function lookupProfessor(email: string): Promise<Professor> {
  return apiSend<Professor>('POST', '/professors/lookup', { email })
}

// ── Staff ────────────────────────────────────────────────────────────────────

export function fetchHiddenReviews(): Promise<StaffReview[]> {
  return apiGet<StaffReview[]>('/staff/subject-reviews')
}

export function restoreHiddenReview(id: string): Promise<void> {
  return apiSend<void>('POST', `/staff/subject-reviews/${encodeURIComponent(id)}/restore`)
}

export function deleteHiddenReview(id: string): Promise<void> {
  return apiSend<void>('DELETE', `/staff/subject-reviews/${encodeURIComponent(id)}`)
}
