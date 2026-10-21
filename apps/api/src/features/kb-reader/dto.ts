// web/kb/dto/* used by KbController, and the import/staff DTOs of the
// services this feature owns (KbImportService, KbModerationService) so the
// StaffKbController port (kb-admin) can reuse them. Key order = record order.

import type { z } from 'zod';
import { jv } from '../../http/validation';

export const KB_REPORT_REASONS = ['CONTENT_ERROR', 'COPYRIGHT', 'PERSONAL_DATA', 'SPAM', 'OTHER'] as const;
export type KbReportReason = (typeof KB_REPORT_REASONS)[number];

/** KbReportRequest(@NotNull KbReportReason reason, @Size(max = 2000) String comment). */
export const KbReportRequest = jv.object({
  reason: jv.enum(KB_REPORT_REASONS, { notNull: true }),
  comment: jv.string({ size: { max: 2000 } }),
});
export type KbReportRequest = NonNullable<z.output<typeof KbReportRequest>>;

/** KbImportPage(@NotBlank @Size(max = 300) String path, String content). */
export const KbImportPage = jv.object({
  path: jv.string({ notBlank: true, size: { max: 300 } }),
  content: jv.string(),
});
export type KbImportPage = NonNullable<z.output<typeof KbImportPage>>;

/** KbImportRequest(@NotNull @Size(max = 500) List<@Valid KbImportPage> pages, boolean replace). */
export const KbImportRequest = jv.object({
  pages: jv.list(KbImportPage, { notNull: true, size: { max: 500 } }),
  replace: jv.bool({ primitive: true }),
});
export type KbImportRequest = NonNullable<z.output<typeof KbImportRequest>>;

export interface AuthorResponse { name: string | null; anonymous: boolean; community: boolean }

export interface KbSourceResponse {
  id: string;
  name: string;
  kind: string;
  author: AuthorResponse | null;
  academicYear: number | null;
  academicYearSource: string | null;
}

export interface KbLinkResponse {
  raw: string;
  subjectId: string;
  slug: string;
  anchor: string | null;
  resolved: boolean;
  title: string | null;
}

export interface KbBacklinkResponse { subjectId: string; subjectName: string | null; slug: string; title: string }

export interface KbPageResponse {
  id: string;
  slug: string;
  title: string;
  type: string;
  summary: string;
  aliases: string[];
  subjectId: string;
  subjectName: string | null;
  markdown: string;
  sources: KbSourceResponse[];
  sourceYears: { min: number | null; max: number | null };
  stale: boolean;
  links: KbLinkResponse[];
  backlinks: KbBacklinkResponse[];
  generator: string;
  generatedAt: string;
  revision: number;
  reportedByMe: boolean;
  status: string;
}

export interface KbPageSummaryResponse {
  id: string;
  slug: string;
  title: string;
  type: string;
  summary: string;
  aliases: string[];
}

export interface KbStaffPageResponse {
  id: string;
  slug: string;
  title: string;
  type: string;
  summary: string;
  aliases: string[];
  subjectId: string;
  status: string;
  reportCount: number;
  hiddenReason: string | null;
}

export interface KbRelatedResponse { subjectId: string; subjectName: string; reason: string; hasWiki: boolean }

export interface KbSubjectResponse {
  subjectId: string;
  subjectName: string;
  index: KbPageResponse | null;
  pages: KbPageSummaryResponse[];
  related: KbRelatedResponse[];
}

export interface KbGraphNode { id: string; subjectId: string; slug: string; title: string; type: string; external: boolean }
export interface KbGraphEdge { from: string; to: string }
export interface KbGraphResponse { nodes: KbGraphNode[]; edges: KbGraphEdge[] }

/** score is a Java double: javaDouble(...) (RawJson). */
export interface KbSearchHit {
  pageId: string;
  subjectId: string;
  slug: string;
  title: string;
  heading: string | null;
  anchor: string | null;
  content: string;
  score: unknown;
}
export interface KbSearchResponse { query: string; results: KbSearchHit[] }

export interface KbRejectedPage { slug: string | null; errors: string[] }
export interface KbImportResponse { accepted: string[]; rejected: KbRejectedPage[]; removed: string[] }

/** web/drive/dto/PageResponse<T>(items, total). */
export interface PageResponse<T> { items: T[]; total: number }
