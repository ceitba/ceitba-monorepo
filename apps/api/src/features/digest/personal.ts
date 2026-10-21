// service/digest/personal/PersonalDigestLoader + TuCuatrimestreSection:
// "Tu cuatrimestre", the per-reader block of the weekly digest, loaded for a
// batch of readers in a fixed number of queries.

import type { Deps } from '../../deps';
import type { Db } from '../../db/client';
import { isAfter, isBefore, javaUrlEncode, plusDays, type LocalDate } from '../../lib/javaCompat';
import { ART, localDateOf } from '../../lib/time';
import { CapabilityService } from '../capability/service';
import type { MailSettings } from '../mail/settings';
import type { PersonalSection } from './logic/digestRenderer';
import { DigestCorrectionVoteTokens } from './logic/digestCorrectionVoteTokens';
import type { DigestWeek } from './logic/digestWeek';
import { selectCorrectionPrompts } from './logic/personal/correctionPrompts';
import { currentTermBySubject, LOOKAHEAD_DAYS, parsePayload, resolve, type Pick, type Resolution } from './logic/personal/digestTerm';
import { renderPersonalDigest } from './logic/personal/personalDigestRenderer';
import { needsSchedule, type CorrectionSlot, type PersonalDigest } from './logic/personal/types';
import * as repo from './repo';

const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/** CorrectionSlots.fromTimes: the SGA slots, HH:mm, sorted by day, from, to. */
export function slotsFromTimes(times: repo.CommissionWithTimes['times']): CorrectionSlot[] {
  return times.map((t) => ({ day: t.day, from: t.hourFrom.slice(0, 5), to: t.hourTo.slice(0, 5) }))
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || cmp(a.from, b.from) || cmp(a.to, b.to));
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** URLEncoder.encode(s).replace("+", "%20") */
const enc = (s: string) => javaUrlEncode(s).replace(/\+/g, '%20');

export class PersonalDigestLoader {
  constructor(private readonly deps: Deps, private readonly settings: MailSettings) {}

  /** Readers with nothing to show are left out of the map (between terms: everyone). */
  async load(db: Db, readerIds: Iterable<string>, week: DigestWeek): Promise<Map<string, PersonalDigest>> {
    const ids = [...new Set([...readerIds].filter((x) => x != null))];
    if (ids.length === 0) return new Map();
    const p = this.settings.personal;
    const today = this.deps.clock.today();
    if (!(await repo.existsRunningOrStartingBy(db, today, plusDays(today, LOOKAHEAD_DAYS)))) return new Map();

    const primary = new Map<string, { payload: unknown; payloadUpdatedAt: number | null }>();
    for (const s of await repo.findPrimarySchedules(db, ids)) primary.set(s.userId, s);
    const picks = new Map<string, Pick[]>();
    const codes = new Set<string>();
    for (const [userId, s] of primary) {
      const list = parsePayload(s.payload);
      picks.set(userId, list);
      for (const x of list) codes.add(x.subjectCode);
    }

    const currentBySubject = codes.size === 0 ? new Map<string, repo.CommissionWithTimes[]>()
      : currentTermBySubject(await repo.findCommissionsBySubjectCodesWithTimes(db, [...codes]), today);

    const resolved = new Map<string, Resolution<repo.CommissionWithTimes>>();
    const currentCodes = new Set<string>();
    const ownCommissionIds = new Set<string>();
    for (const [userId, list] of picks) {
      const saved = primary.get(userId)!.payloadUpdatedAt;
      const savedOn = saved == null ? null : localDateOf(saved, ART);
      const r = resolve(list, savedOn, currentBySubject);
      if (!r.current) continue;
      resolved.set(userId, r);
      for (const s of r.subjects) {
        currentCodes.add(s.subjectCode);
        if (s.commissionName != null) for (const c of s.commissions) ownCommissionIds.add(c.id);
      }
    }

    const names = currentCodes.size === 0 ? new Map<string, string>() : await repo.findSubjectNames(db, [...currentCodes]);

    let wikiReaders = new Set<string>();
    let wiki = new Map<string, { url: string; updatedThisWeek: boolean }>();
    if (resolved.size > 0 && p.maxWikiLinks > 0) {
      const withSchedule = await repo.findUsersByIds(db, [...resolved.keys()]);
      wikiReaders = await new CapabilityService(this.deps).holders('apuntes', withSchedule, db);
      if (wikiReaders.size > 0) wiki = await this.wikiHeads(db, [...currentCodes], week);
    }

    const pendingByCommission = new Map<string, repo.CorrectionRow[]>();
    const votedBy = new Map<string, Set<string>>();
    if (ownCommissionIds.size > 0 && p.maxCorrections > 0) {
      const pending = await repo.findCorrectionsByCommissionsAndStatus(db, [...ownCommissionIds], ['PENDING']);
      for (const c of pending) {
        let l = pendingByCommission.get(c.commissionId);
        if (!l) pendingByCommission.set(c.commissionId, (l = []));
        l.push(c);
      }
      if (pending.length > 0) {
        for (const v of await repo.findVotesOf(db, [...resolved.keys()], pending.map((c) => c.id))) {
          let s = votedBy.get(v.userId);
          if (!s) votedBy.set(v.userId, (s = new Set()));
          s.add(v.correctionId);
        }
      }
    }
    const commissionById = new Map<string, repo.CommissionWithTimes>();
    for (const list of currentBySubject.values()) for (const c of list) if (!commissionById.has(c.id)) commissionById.set(c.id, c);

    const out = new Map<string, PersonalDigest>();
    for (const userId of ids) {
      const r = resolved.get(userId);
      if (r == null) {
        out.set(userId, needsSchedule());
        continue;
      }
      const subjects: PersonalDigest['subjects'] = [];
      const links: PersonalDigest['wiki'] = [];
      const mine = new Set<string>();
      const wikiReader = wikiReaders.has(userId);
      for (const s of r.subjects) {
        const name = names.get(s.subjectCode) ?? s.subjectCode;
        subjects.push({ code: s.subjectCode, name, commissionName: s.commissionName });
        if (s.commissionName != null) for (const c of s.commissions) mine.add(c.id);
        const head = wiki.get(s.subjectCode);
        if (wikiReader && head != null && links.length < p.maxWikiLinks) {
          links.push({ subjectCode: s.subjectCode, subjectName: name, url: head.url, updatedThisWeek: head.updatedThisWeek });
        }
      }
      const candidates = [...mine].flatMap((id) => pendingByCommission.get(id) ?? []);
      const prompts = selectCorrectionPrompts(userId, mine, candidates, votedBy.get(userId) ?? new Set(), p.maxCorrections)
        .map((c) => {
          const commission = commissionById.get(c.commissionId)!;
          return {
            correctionId: c.id,
            subjectName: names.get(commission.subjectCode) ?? commission.subjectCode,
            commissionName: commission.commissionName,
            proposed: c.proposedSlots,
            sga: slotsFromTimes(commission.times),
          };
        });
      out.set(userId, { state: 'CURRENT', subjects, wiki: links, corrections: prompts });
    }
    return out;
  }

  private async wikiHeads(db: Db, codes: string[], week: DigestWeek): Promise<Map<string, { url: string; updatedThisWeek: boolean }>> {
    const bySubject = new Map<string, Awaited<ReturnType<typeof repo.findPublishedHeads>>>();
    for (const row of await repo.findPublishedHeads(db, codes)) {
      let l = bySubject.get(row.subjectId);
      if (!l) bySubject.set(row.subjectId, (l = []));
      l.push(row);
    }
    const out = new Map<string, { url: string; updatedThisWeek: boolean }>();
    for (const [code, list] of bySubject) {
      const hasIndex = list.some((r) => r.type === 'INDEX');
      // BinaryOperator.maxBy keeps the first of equal maxima.
      let latest = list[0]!;
      for (const r of list) if (r.generatedAt > latest.generatedAt) latest = r;
      const base = `${this.settings.personal.wikiBaseUrl}/${enc(code)}`;
      const url = hasIndex ? `${base}?vista=wiki` : `${base}/wiki/${enc(latest.slug)}`;
      const updated = list.some((r) => {
        const day: LocalDate = localDateOf(r.generatedAt, ART);
        return !isBefore(day, week.weekStart) && !isAfter(day, week.weekEnd());
      });
      out.set(code, { url, updatedThisWeek: updated });
    }
    return out;
  }
}

/** TuCuatrimestreSection: the rendered block per reader, with signed vote links. */
export class TuCuatrimestreSection {
  private readonly loader: PersonalDigestLoader;

  constructor(deps: Deps, private readonly settings: MailSettings, private readonly tokens: DigestCorrectionVoteTokens) {
    this.loader = new PersonalDigestLoader(deps, settings);
  }

  async forReaders(db: Db, readerIds: Iterable<string>, week: DigestWeek): Promise<Map<string, PersonalSection>> {
    const out = new Map<string, PersonalSection>();
    for (const [userId, p] of await this.loader.load(db, readerIds, week)) {
      out.set(userId, renderPersonalDigest(p, this.settings.personal.schedulerUrl, (correctionId) => {
        const base = `${this.settings.digest.publicBaseUrl}/correction?token=${javaUrlEncode(this.tokens.issue(userId, correctionId))}`;
        return { confirm: `${base}&vote=confirm`, reject: `${base}&vote=reject` };
      }));
    }
    return out;
  }
}
