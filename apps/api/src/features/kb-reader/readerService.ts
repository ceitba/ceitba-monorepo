// service/kb/KbReaderService: subject wikis for logged-in readers
// (docs/SUBJECT-WIKI.md). Readers see PUBLISHED pages only; STAFF also see
// HIDDEN ones. `staff` is StaffPowers.isStaff(caller), resolved by the route
// (an API key without the `staff` scope reads like a student).

import type { Deps } from '../../deps';
import { withTx, type Db } from '../../db/client';
import { ResourceNotFoundError } from '../../http/errors';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { systemNowMicros, toPgTimestamp } from '../../lib/time';
import type {
  KbGraphEdge, KbGraphNode, KbGraphResponse, KbPageResponse, KbRelatedResponse, KbReportRequest, KbSubjectResponse,
} from './dto';
import * as repo from './repo';
import type { KbPageRow, KbPageStatus } from './repo';
import { KbViews, sorted, summary, visible, wire } from './views';

export const REPORT_THRESHOLD = 3;
const STAFF_VISIBLE: readonly KbPageStatus[] = ['PUBLISHED', 'HIDDEN'];
const READER_VISIBLE: readonly KbPageStatus[] = ['PUBLISHED'];

type Caller = { id: string };

export class KbReaderService {
  readonly views: KbViews;

  constructor(private readonly deps: Pick<Deps, 'db' | 'config' | 'clock'>) {
    this.views = new KbViews(deps);
  }

  /** @Transactional(readOnly = true) */
  subject(user: Caller, subjectId: string, staff: boolean): Promise<KbSubjectResponse> {
    return withTx(this.deps.db, async (tx) => {
      const subject = await repo.findSubject(tx, subjectId);
      if (!subject) throw new ResourceNotFoundError('Subject', subjectId);
      const visiblePages = sorted(await repo.pagesBySubjectAndStatusIn(tx, subjectId, staff ? STAFF_VISIBLE : READER_VISIBLE));
      const indexPage = visiblePages.find((p) => p.type === 'INDEX');
      const index = indexPage ? await this.views.page(tx, indexPage, user.id, staff) : null;
      return {
        subjectId: subject.id, subjectName: subject.name, index,
        pages: visiblePages.map(summary), related: await this.related(tx, subjectId, visiblePages),
      };
    }, { readOnly: true });
  }

  // Prerequisites, then dependents (both by number of plans), then subjects
  // this wiki links to or that link to it. One entry per subject.
  private async related(tx: Db, subjectId: string, visiblePages: KbPageRow[]): Promise<KbRelatedResponse[]> {
    const reasonBySubject = new Map<string, string>();
    const putIfAbsent = (k: string, v: string) => { if (!reasonBySubject.has(k)) reasonBySubject.set(k, v); };
    const rows = await repo.relationsOf(tx, subjectId);
    for (const reason of ['PREREQUISITE', 'DEPENDENT']) {
      for (const r of rows) if (r.reason === reason) putIfAbsent(r.relatedId, reason);
    }
    const linked = new Set<string>();
    const ownIds = visiblePages.map((p) => p.id);
    if (ownIds.length > 0) {
      for (const l of await repo.linksFromIn(tx, ownIds)) linked.add(l.toSubjectId);
    }
    const incoming = [...new Set((await repo.linksToSubject(tx, subjectId)).map((l) => l.fromPageId))];
    for (const p of await repo.pagesByIds(tx, incoming)) {
      if (p.status === 'PUBLISHED') linked.add(p.subjectId);
    }
    for (const s of linked) putIfAbsent(s, 'LINKED');
    reasonBySubject.delete(subjectId);
    if (reasonBySubject.size === 0) return [];

    const names = await repo.subjectNames(tx, reasonBySubject.keys());
    const withWiki = new Set(await repo.subjectIdsWithPages(tx, reasonBySubject.keys(), READER_VISIBLE));
    const out: KbRelatedResponse[] = [];
    for (const [id, reason] of reasonBySubject) {
      if (names.has(id)) out.push({ subjectId: id, subjectName: names.get(id)!, reason, hasWiki: withWiki.has(id) });
    }
    return out;
  }

  /** @Transactional(readOnly = true) */
  page(user: Caller, subjectId: string, slug: string, staff: boolean): Promise<KbPageResponse> {
    return withTx(this.deps.db, async (tx) => {
      const page = await repo.pageBySubjectAndSlug(tx, subjectId, slug);
      if (!visible(page, staff)) throw new ResourceNotFoundError('KbPage', `${subjectId}/${slug}`);
      return this.views.page(tx, page, user.id, staff);
    }, { readOnly: true });
  }

  /** @Transactional(readOnly = true) */
  graph(user: Caller, subjectId: string, staff: boolean): Promise<KbGraphResponse> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.subjectExists(tx, subjectId))) throw new ResourceNotFoundError('Subject', subjectId);
      const nodes = new Map<string, KbPageRow>();
      const own = sorted(await repo.pagesBySubjectAndStatusIn(tx, subjectId, staff ? STAFF_VISIBLE : READER_VISIBLE));
      for (const p of own) nodes.set(p.id, p);
      if (own.length === 0) return { nodes: [], edges: [] };
      const ownIds = [...nodes.keys()];

      const out = await repo.linksFromIn(tx, ownIds);
      const incoming = await repo.linksToIn(tx, ownIds);
      const otherIds = new Set<string>();
      for (const l of out) if (l.toPageId != null && !nodes.has(l.toPageId)) otherIds.add(l.toPageId);
      for (const l of incoming) if (!nodes.has(l.fromPageId)) otherIds.add(l.fromPageId);
      const external = new Map<string, KbPageRow>();
      for (const p of await repo.pagesByIds(tx, otherIds)) if (visible(p, staff)) external.set(p.id, p);

      const edges = new Map<string, KbGraphEdge>();
      const addEdge = (from: string, to: string) => { const k = `${from}|${to}`; if (!edges.has(k)) edges.set(k, { from, to }); };
      for (const l of out) {
        if (l.toPageId != null && (nodes.has(l.toPageId) || external.has(l.toPageId)) && l.toPageId !== l.fromPageId) {
          addEdge(l.fromPageId, l.toPageId);
        }
      }
      for (const l of incoming) {
        if (external.has(l.fromPageId)) addEdge(l.fromPageId, l.toPageId!);
      }
      const nodeDtos: KbGraphNode[] = [];
      for (const p of nodes.values()) nodeDtos.push(node(p, false));
      for (const p of sorted([...external.values()])) nodeDtos.push(node(p, true));
      return { nodes: nodeDtos, edges: [...edges.values()] };
    }, { readOnly: true });
  }

  // One report per reader and page (a new one replaces it); at 3 a PUBLISHED
  // page is hidden. Only PUBLISHED pages can be reported (or re-reported by
  // someone who already did).
  /** @Transactional */
  report(user: Caller, pageId: string, req: KbReportRequest): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const page = await repo.pageById(tx, pageId);
      if (!page) throw new ResourceNotFoundError('KbPage', pageId);
      const existing = await repo.findReport(tx, pageId, user.id);
      if (page.status !== 'PUBLISHED' && !existing) throw new ResourceNotFoundError('KbPage', pageId);
      const now = toPgTimestamp(this.deps.clock.now());
      const comment = req.comment == null || javaIsBlank(req.comment) ? null : javaTrim(req.comment);
      if (existing) await repo.updateReport(tx, pageId, user.id, req.reason!, comment, now);
      else await repo.insertReport(tx, pageId, user.id, req.reason!, comment, now);
      const reportCount = await repo.countReports(tx, pageId);
      let status = page.status;
      let hiddenReason = page.hiddenReason ?? null;
      if (status === 'PUBLISHED' && reportCount >= REPORT_THRESHOLD) {
        status = 'HIDDEN';
        hiddenReason = 'REPORTS';
      }
      // Hibernate writes the page (and bumps updated_at) only when it changed.
      if (reportCount !== page.reportCount || status !== page.status || hiddenReason !== (page.hiddenReason ?? null)) {
        await repo.updatePageState(tx, pageId, { status, hiddenReason, reportCount }, toPgTimestamp(systemNowMicros()));
      }
    });
  }
}

function node(p: KbPageRow, external: boolean): KbGraphNode {
  return { id: p.id, subjectId: p.subjectId, slug: p.slug, title: p.title, type: wire(p.type), external };
}
