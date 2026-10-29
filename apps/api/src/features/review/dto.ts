// Subject reviews (docs/SUBJECT-REVIEWS.md): request schemas and response shapes.

import type { z } from 'zod';
import { jv } from '../../http/validation';

export const REVIEW_REPORT_REASONS = ['OFFENSIVE', 'PERSONAL_DATA', 'FALSE', 'SPAM', 'OTHER'] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

export const MAX_PROFESSORS_PER_REVIEW = 6;

const reviewFields = {
  year: jv.int({ notNull: true, min: 2000, max: 2100 }),
  period: jv.int({ notNull: true, min: 1, max: 2 }),
  commission: jv.string({ notBlank: true, size: { max: 20 } }),
  recommend: jv.bool({ notNull: true }),
  difficulty: jv.int({ notNull: true, min: 1, max: 3 }),
  professorIds: jv.list(jv.uuid({ notNull: true }), { size: { max: MAX_PROFESSORS_PER_REVIEW } }),
  comment: jv.string({ size: { max: 2000 } }),
};

/** Create and edit take the same fields; an absent professorIds means none. */
export const SaveReviewRequest = jv.object(reviewFields);
export type SaveReviewRequest = NonNullable<z.output<typeof SaveReviewRequest>>;

export const ReportReviewRequest = jv.object({
  reason: jv.enum(REVIEW_REPORT_REASONS, { notNull: true }),
  comment: jv.string({ size: { max: 2000 } }),
});
export type ReportReviewRequest = NonNullable<z.output<typeof ReportReviewRequest>>;

export const LookupProfessorRequest = jv.object({
  email: jv.string({ notBlank: true, email: true, size: { max: 255 } }),
});
export type LookupProfessorRequest = NonNullable<z.output<typeof LookupProfessorRequest>>;

/** A professor as readers see them: the email never leaves the API. */
export interface ProfessorResponse { id: string; name: string }

export interface ReviewResponse {
  id: string;
  year: number;
  period: number;
  commission: string;
  professorIds: string[];
  recommend: boolean;
  difficulty: number;
  comment: string | null;
  helpfulCount: number;
  /** The caller marked it "Me sirvió". */
  helpful: boolean;
  /** The caller reported it. */
  reported: boolean;
  /** The caller wrote it. */
  mine: boolean;
  /** Only ever true on the caller's own review (others' hidden reviews are not listed). */
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubjectReviewsResponse {
  subjectId: string;
  subjectName: string;
  /** Newest term first, then newest first. */
  reviews: ReviewResponse[];
  /** Every professor some listed review names, by name. */
  professors: ProfessorResponse[];
}

export interface ReviewReportResponse { reason: ReviewReportReason; comment: string | null; createdAt: string }

export interface StaffReviewResponse {
  id: string;
  subjectId: string;
  subjectName: string;
  year: number;
  period: number;
  commission: string;
  professors: ProfessorResponse[];
  recommend: boolean;
  difficulty: number;
  comment: string | null;
  reportCount: number;
  reports: ReviewReportResponse[];
  createdAt: string;
  updatedAt: string;
}
