// service/kb/KbViews: row -> DTO mapping for the subject wikis, inside the
// callers' transactions. Pages read from the database print generatedAt with
// `Z` (Hibernate normalizes TIMESTAMPTZ to UTC).

import type { Deps } from '../../deps';
import type { Db } from '../../db/client';
import { javaCharToUpperCase, javaCompareStrings, javaIsBlank } from '../../lib/javaCompat';
import { formatOffsetDateTime, parsePgTimestamp } from '../../lib/time';
import { charToLowerCase } from '../kb/logic/javaString';
import * as wikilinks from '../kb/logic/kbWikilinks';
import { KB_PAGE_TYPES, type KbPageType } from '../kb/logic/types';
import type {
  AuthorResponse, KbBacklinkResponse, KbLinkResponse, KbPageResponse, KbPageSummaryResponse, KbSourceResponse,
  KbStaffPageResponse,
} from './dto';
import * as repo from './repo';
import type { KbPageRow } from './repo';

/** DriveViews.COMMUNITY_LABEL. */
export const COMMUNITY_LABEL = 'Comunidad';

/** KbPageType.wire(). */
export const wire = (type: string): string => type.toLowerCase();

/** Readers see PUBLISHED pages; staff also HIDDEN ones. */
export function visible(p: KbPageRow | null | undefined, staff: boolean): p is KbPageRow {
  return p != null && (p.status === 'PUBLISHED' || (staff && p.status === 'HIDDEN'));
}

/** String.CASE_INSENSITIVE_ORDER (char by char: upper case, then lower case). */
export function compareIgnoreCase(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let c1 = a[i]!;
    let c2 = b[i]!;
    if (c1 === c2) continue;
    c1 = javaCharToUpperCase(c1);
    c2 = javaCharToUpperCase(c2);
    if (c1 === c2) continue;
    c1 = charToLowerCase(c1);
    c2 = charToLowerCase(c2);
    if (c1 !== c2) return c1.charCodeAt(0) - c2.charCodeAt(0);
  }
  return a.length - b.length;
}

/** KbViews.ORDER: index first, then topics, then concepts (enum order); by title, ignoring case. */
export function order(a: KbPageRow, b: KbPageRow): number {
  const t = KB_PAGE_TYPES.indexOf(a.type as KbPageType) - KB_PAGE_TYPES.indexOf(b.type as KbPageType);
  return t !== 0 ? t : compareIgnoreCase(a.title, b.title);
}

export const sorted = (rows: KbPageRow[]): KbPageRow[] => [...rows].sort(order);

/** An OffsetDateTime column read through Hibernate. */
export const dbOffsetDateTime = (pg: string): string => formatOffsetDateTime(parsePgTimestamp(pg));

export function summary(p: KbPageRow): KbPageSummaryResponse {
  return { id: p.id, slug: p.slug, title: p.title, type: wire(p.type), summary: p.summary, aliases: [...p.aliases] };
}

export function staffView(p: KbPageRow): KbStaffPageResponse {
  return {
    id: p.id, slug: p.slug, title: p.title, type: wire(p.type), summary: p.summary, aliases: [...p.aliases],
    subjectId: p.subjectId, status: p.status, reportCount: p.reportCount, hiddenReason: p.hiddenReason ?? null,
  };
}

/** DriveViews.author(source, owner). */
export function author(source: repo.SourceRow, ownerName: string | null | undefined, hasOwner: boolean): AuthorResponse {
  if (source.kind !== 'STUDENT') {
    const label = source.displayName == null || javaIsBlank(source.displayName) ? COMMUNITY_LABEL : source.displayName;
    return { name: label, anonymous: false, community: true };
  }
  if (source.anonymous) return { name: null, anonymous: true, community: false };
  return { name: hasOwner ? (ownerName ?? null) : null, anonymous: false, community: false };
}

export class KbViews {
  constructor(private readonly deps: Pick<Deps, 'config' | 'clock'>) {}

  async page(db: Db, p: KbPageRow, viewerId: string | null, staff: boolean): Promise<KbPageResponse> {
    const subjectIds = new Set<string>([p.subjectId]);

    // Links of this page.
    const out = await repo.linksFrom(db, p.id);
    const targets = new Map<string, KbPageRow>();
    for (const t of await repo.pagesByIds(db, out.map((l) => l.toPageId))) targets.set(t.id, t);
    const links: KbLinkResponse[] = [...out]
      .sort((a, b) => javaCompareStrings(a.raw, b.raw))
      .map((l) => {
        const t = l.toPageId == null ? null : targets.get(l.toPageId) ?? null;
        const resolved = visible(t, staff);
        const anchor = wikilinks.target(l.raw, p.subjectId, p.slug).anchor;
        return { raw: l.raw, subjectId: l.toSubjectId, slug: l.toSlug, anchor, resolved, title: resolved ? t!.title : null };
      });

    // Pages linking here.
    const incoming = await repo.linksTo(db, p.id);
    const fromPages = sorted((await repo.pagesByIds(db, incoming.map((l) => l.fromPageId)))
      .filter((f) => visible(f, staff) && f.id !== p.id));
    for (const f of fromPages) subjectIds.add(f.subjectId);
    const names = await repo.subjectNames(db, subjectIds);
    const backlinks: KbBacklinkResponse[] = fromPages.map((f) => ({
      subjectId: f.subjectId, subjectName: names.get(f.subjectId) ?? null, slug: f.slug, title: f.title,
    }));

    const sources = await this.sources(db, p.sources, staff);
    const years = sources.map((s) => s.academicYear).filter((y): y is number => y != null);
    const min = years.length === 0 ? null : Math.min(...years);
    const max = years.length === 0 ? null : Math.max(...years);
    const currentYear = Number(this.deps.clock.today().slice(0, -6));
    const stale = max != null && max < currentYear - this.deps.config.kb.staleYears;
    return {
      id: p.id, slug: p.slug, title: p.title, type: wire(p.type), summary: p.summary, aliases: [...p.aliases],
      subjectId: p.subjectId, subjectName: names.get(p.subjectId) ?? null, markdown: p.markdown,
      sources, sourceYears: { min, max }, stale, links, backlinks, generator: p.generator,
      generatedAt: dbOffsetDateTime(p.generatedAt), revision: p.revision,
      reportedByMe: viewerId != null && (await repo.reportExists(db, p.id, viewerId)),
      status: p.status,
    };
  }

  /** Cited files as STAFF see them (eval review pages). */
  staffSources(db: Db, ids: string[]): Promise<KbSourceResponse[]> {
    return this.sources(db, ids, true);
  }

  /** The cited files, in frontmatter order; readers only get PUBLISHED ones. */
  private async sources(db: Db, ids: string[], staff: boolean): Promise<KbSourceResponse[]> {
    if (ids.length === 0) return [];
    const byId = new Map((await repo.citedFiles(db, ids)).map((f) => [f.id, f]));
    const sourceById = new Map((await repo.driveSources(db, [...new Set([...byId.values()].map((f) => f.sourceId))])).map((s) => [s.id, s]));
    const owners = await repo.userNames(db, [...sourceById.values()].map((s) => s.userId));
    const out: KbSourceResponse[] = [];
    for (const id of ids) {
      const f = byId.get(id);
      if (!f || !(staff || f.publication === 'PUBLISHED')) continue;
      const src = sourceById.get(f.sourceId);
      const a = src == null ? null : author(src, src.userId == null ? null : owners.get(src.userId), src.userId != null && owners.has(src.userId));
      out.push({ id: f.id, name: f.name, kind: f.kind, author: a, academicYear: f.academicYear ?? null, academicYearSource: f.academicYearSource ?? null });
    }
    return out;
  }
}
