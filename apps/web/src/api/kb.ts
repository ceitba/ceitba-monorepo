import { apiGet, apiSend } from './client'
import type { FileKind } from './drive'

// Subject wikis: AI-written Markdown pages per subject, built from the
// published Apuntes and cross-linked between subjects.
// Contract: CEITBA-API docs/SUBJECT-WIKI.md.

export type KbPageType = 'index' | 'topic' | 'concept'

export type KbReportReason = 'CONTENT_ERROR' | 'COPYRIGHT' | 'PERSONAL_DATA' | 'SPAM' | 'OTHER'

export const KB_REPORT_REASONS: KbReportReason[] = ['CONTENT_ERROR', 'COPYRIGHT', 'PERSONAL_DATA', 'SPAM', 'OTHER']

export interface KbPageSummary {
  id: string
  slug: string
  title: string
  type: KbPageType
  summary: string
  aliases: string[]
}

export interface KbSource {
  id: string
  name: string
  kind: FileKind
  author: { name: string | null; anonymous: boolean }
}

// One entry per wikilink target in the body. `raw` is the text inside
// [[…]] before "|": "slug", "81.07/slug" or "81.07" (a subject's index).
export interface KbLink {
  raw: string
  subjectId: string
  slug: string | null
  resolved: boolean
  title: string | null
  // Section anchor for [[slug#anchor]] links (raw keeps the "#…"). Older
  // API builds don't send it: the renderer then parses it from raw.
  anchor?: string | null
}

export interface KbBacklink {
  subjectId: string
  subjectName: string
  slug: string
  title: string
}

export interface KbPage extends KbPageSummary {
  subjectId: string
  subjectName: string
  // Body without frontmatter.
  markdown: string
  sources: KbSource[]
  links: KbLink[]
  backlinks: KbBacklink[]
  generator: string
  generatedAt: string
  revision: number
  reportedByMe: boolean
}

// PREREQUISITE: this subject needs it (correlativa); DEPENDENT: it needs
// this subject; LINKED: wiki pages link between them.
export type KbRelatedReason = 'PREREQUISITE' | 'DEPENDENT' | 'LINKED'

export interface KbRelated {
  subjectId: string
  subjectName: string
  reason: KbRelatedReason
  hasWiki: boolean
}

export interface SubjectKb {
  subjectId: string
  subjectName: string
  index: KbPage | null
  pages: KbPageSummary[]
  related: KbRelated[]
}

export interface KbGraphNode {
  id: string
  subjectId: string
  slug: string
  title: string
  type: KbPageType
  // A page of another subject that this subject's pages link to / from.
  external: boolean
}

export interface KbGraph {
  nodes: KbGraphNode[]
  edges: { from: string; to: string }[]
}

const enc = encodeURIComponent

export function fetchSubjectKb(subjectId: string): Promise<SubjectKb> {
  return apiGet<SubjectKb>(`/wiki/subjects/${enc(subjectId)}/kb`)
}

export function fetchKbPage(subjectId: string, slug: string): Promise<KbPage> {
  return apiGet<KbPage>(`/wiki/subjects/${enc(subjectId)}/kb/${enc(slug)}`)
}

export function fetchKbGraph(subjectId: string): Promise<KbGraph> {
  return apiGet<KbGraph>(`/wiki/subjects/${enc(subjectId)}/kb/graph`)
}

// Global wiki map (all subjects, or only `subjects`). Nodes cluster by
// subject; crossSubject edges join different subjects.
export interface GlobalKbGraph {
  subjects: { subjectId: string; subjectName: string; pageCount: number }[]
  nodes: { id: string; subjectId: string; slug: string; title: string; type: KbPageType }[]
  edges: { from: string; to: string; crossSubject: boolean }[]
}

export function fetchGlobalGraph(subjects?: string[]): Promise<GlobalKbGraph> {
  const qs = subjects && subjects.length ? `?subjects=${subjects.map(enc).join(',')}` : ''
  return apiGet<GlobalKbGraph>(`/wiki/kb/graph${qs}`)
}

export function reportKbPage(pageId: string, body: { reason: KbReportReason; comment: string }): Promise<void> {
  return apiSend<void>('PUT', `/wiki/kb/pages/${enc(pageId)}/report`, body)
}

// ── Staff ───────────────────────────────────────────────────────────────────

export type KbPageStatus = 'PUBLISHED' | 'HIDDEN' | 'REMOVED'

export interface StaffKbPage extends KbPageSummary {
  subjectId: string
  status: KbPageStatus
  reportCount: number
}

export function fetchStaffKbPages(params: { status: KbPageStatus; page?: number; limit?: number }): Promise<{ items: StaffKbPage[]; total: number }> {
  const qs = new URLSearchParams({ status: params.status, page: String(params.page ?? 0), limit: String(params.limit ?? 20) })
  return apiGet(`/staff/kb/pages?${qs}`)
}

export function hideKbPage(pageId: string): Promise<KbPage> {
  return apiSend<KbPage>('POST', `/staff/kb/pages/${enc(pageId)}/hide`)
}

export function restoreKbPage(pageId: string): Promise<KbPage> {
  return apiSend<KbPage>('POST', `/staff/kb/pages/${enc(pageId)}/restore`)
}

// Router path for a wiki page ("index" is the subject's wiki home).
export function kbPagePath(subjectId: string, slug: string | null | undefined): string {
  const base = `/apuntes/${enc(subjectId)}`
  return !slug || slug === 'index' ? base : `${base}/wiki/${enc(slug)}`
}
