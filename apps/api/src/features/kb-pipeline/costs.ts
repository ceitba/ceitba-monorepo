// Ports of apps/api/src/main/java/org/ceitba/api/service/kb/admin/KbCostService.java and
// KbQuotaService.java.
//
// Cost analytics over kb_llm_usage (docs/SUBJECT-WIKI-ADMIN.md §3). Stored costs
// are frozen at the price of their run; reprice=true recomputes them with
// today's catalog prices on read.

import type { Database } from '../../db/client';
import { ValidationError } from '../../http/errors';
import { Dec } from '../kb/logic/decimal';
import { cost } from '../kb/logic/llm/kbPricing';
import type { DoQuotaTracker } from '../kb/logic/external/doQuotaTracker';
import { jIsBlank, jSplit, jTrim, lowerRoot } from '../kb/logic/javaString';
import { ART_ZONE, type Now, type Odt } from '../kb/logic/odt';
import { completed } from '../kb/logic/pipeline/kbRunOutcome';
import type { KbModelReader } from '../kb/logic/ports';
import type { KbModel } from '../kb/logic/types';
import { javaDouble } from '../../lib/json';
import { runs, subjects, usage, type UsageRow } from './db/repo';
import { inTx } from './db/session';
import { odtJson, type KbCostRowResponse, type KbCostSummaryResponse, type KbQuotaCounter, type KbQuotaResponse } from './dto';

export const DIMENSIONS = ['week', 'stage', 'model', 'subject'];
/** Longest range /costs reads at once. */
export const MAX_RANGE_DAYS = 366;

export function usd(v: Dec | null): Dec {
  return (v ?? Dec.ZERO).setScale(4, 'HALF_UP');
}

/** "a, b" -> [a, b] (blank parts dropped). */
export function list(csv: string | null): string[] {
  const out: string[] = [];
  if (csv == null) return out;
  for (const s of jSplit(csv, ',')) if (!jIsBlank(s)) out.push(jTrim(s));
  return out;
}

/** ISO date of the Monday of the usage's week, Buenos Aires time. */
export function week(at: Odt): string {
  const local = at.withOffset(zoneOffset(at)).local();
  const d = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function zoneOffset(at: Odt): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: ART_ZONE, timeZoneName: 'longOffset' });
  const part = fmt.formatToParts(new Date(at.toEpochMilli())).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part);
  if (!m) return 0;
  const secs = Number(m[2]) * 3600 + Number(m[3] ?? 0) * 60;
  return m[1] === '-' ? -secs : secs;
}

const cmpNullsFirst = (a: string | null, b: string | null): number =>
  a == null ? (b == null ? 0 : -1) : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0;

export class KbCostService {
  constructor(private readonly db: Database, private readonly models: KbModelReader, private readonly now: Now) {}

  private async catalog(): Promise<Map<string, KbModel>> {
    const out = new Map<string, KbModel>();
    for (const m of await this.models.findAll()) out.set(m.id, m);
    return out;
  }

  /**
   * groupBy: one or more of week, stage, model, subject (comma separated). Default
   * range: the 30 days up to `to` (default now); at most 366 days.
   */
  costs(from: Odt | null, to: Odt | null, groupBy: string | null, reprice: boolean): Promise<KbCostRowResponse[]> {
    return inTx(this.db, async () => {
      const now = this.now();
      const t = to ?? now;
      const f = from ?? t.plusHours(-30 * 24);
      if (f.isAfter(t)) throw new ValidationError('from', f.toString(), 'must not be after to');
      if (f.plusHours(MAX_RANGE_DAYS * 24).isBefore(t)) {
        throw new ValidationError('from', f.toString(), `the range may span at most ${MAX_RANGE_DAYS} days`);
      }
      const dims = list(groupBy == null || jIsBlank(groupBy) ? 'week' : lowerRoot(groupBy));
      for (const d of dims) {
        if (!DIMENSIONS.includes(d)) {
          throw new ValidationError('groupBy', groupBy, `must be one or more of [${DIMENSIONS.join(', ')}]`);
        }
      }
      const catalog = await this.catalog();
      const tokens = new Map<string, { key: (string | null)[]; acc: [number, number, number, number]; cost: Dec }>();
      for (const u of await usage.findByCreatedAtBetween(f, t)) {
        const key = [
          dims.includes('week') ? week(u.createdAt) : null,
          dims.includes('stage') ? u.stage : null,
          dims.includes('model') ? u.model : null,
          dims.includes('subject') ? (u.subjectId == null ? '-' : u.subjectId) : null,
        ];
        const k = JSON.stringify(key);
        let e = tokens.get(k);
        if (!e) tokens.set(k, (e = { key, acc: [0, 0, 0, 0], cost: Dec.ZERO }));
        e.acc[0] += u.inputTokens;
        e.acc[1] += u.cachedInputTokens;
        e.acc[2] += u.outputTokens;
        e.acc[3]++;
        e.cost = e.cost.add(reprice
          ? cost(catalog.get(u.model) ?? null, u.mode, u.inputTokens, u.cachedInputTokens, u.outputTokens)
          : u.costUsd);
      }
      const rows = [...tokens.values()].map(({ key, acc, cost: c }) => {
        const parts = dims.map((d) => (d === 'week' ? key[0] : d === 'stage' ? key[1] : d === 'model' ? key[2] : key[3]));
        const row: KbCostRowResponse = { key: parts.join('|') } as KbCostRowResponse;
        if (key[0] != null) row.week = key[0];
        if (key[1] != null) row.stage = key[1];
        if (key[2] != null) row.model = key[2];
        if (key[3] != null) row.subjectId = key[3];
        row.inputTokens = acc[0];
        row.cachedInputTokens = acc[1];
        row.outputTokens = acc[2];
        row.costUsd = usd(c);
        row.requests = acc[3];
        return row;
      });
      rows.sort((a, b) => cmpNullsFirst(a.week ?? null, b.week ?? null) || cmpNullsFirst(a.stage ?? null, b.stage ?? null)
        || cmpNullsFirst(a.model ?? null, b.model ?? null) || cmpNullsFirst(a.subjectId ?? null, b.subjectId ?? null));
      return rows;
    });
  }

  summary(): Promise<KbCostSummaryResponse> {
    return inTx(this.db, async () => {
      const now = this.now();
      const last30: UsageRow[] = await usage.findByCreatedAtBetween(now.plusHours(-30 * 24), now);
      let last7 = Dec.ZERO;
      let total30 = Dec.ZERO;
      let last28 = Dec.ZERO;
      let input = 0;
      let cached = 0;
      let simulated = false;
      const byStage = new Map<string, Dec>();
      const byModel = new Map<string, Dec>();
      const bySubject = new Map<string, Dec>();
      const seven = now.plusHours(-7 * 24);
      const twentyEight = now.plusHours(-28 * 24);
      for (const u of last30) {
        const c = u.costUsd;
        total30 = total30.add(c);
        if (u.createdAt.isAfter(seven)) last7 = last7.add(c);
        if (u.createdAt.isAfter(twentyEight)) last28 = last28.add(c);
        input += u.inputTokens;
        cached += u.cachedInputTokens;
        simulated ||= u.simulated;
        byStage.set(u.stage, (byStage.get(u.stage) ?? Dec.ZERO).add(c));
        byModel.set(u.model, (byModel.get(u.model) ?? Dec.ZERO).add(c));
        if (u.subjectId != null) bySubject.set(u.subjectId, (bySubject.get(u.subjectId) ?? Dec.ZERO).add(c));
      }
      // Average week of the last 4 weeks x 4.345 weeks per month.
      const projected = last28.divide(Dec.fromInt(4), 6, 'HALF_UP').multiply(Dec.parse('4.345'));
      const names = await subjects.names([...bySubject.keys()]);
      const top = [...bySubject.entries()].sort((a, b) => b[1].compareTo(a[1])).slice(0, 5)
        .map(([subjectId, c]) => ({ subjectId, subjectName: names.get(subjectId) ?? null, costUsd: usd(c) }));
      const sorted = (m: Map<string, Dec>): Record<string, Dec> => {
        const o: Record<string, Dec> = {};
        for (const k of [...m.keys()].sort()) o[k] = usd(m.get(k)!);
        return o;
      };
      const ratio = input === 0 ? 0 : cached / input;
      const accuracy = (await runs.findByTriggerNotOrderByStartedAtDesc('EVAL', 30))
        .filter((r) => completed(r.status) && r.expectedCostUsd != null)
        .slice(0, 8)
        .map((r) => ({
          runId: r.id, startedAt: odtJson(r.startedAt), trigger: r.trigger,
          expectedUsd: usd(r.expectedCostUsd), actualUsd: usd(r.costEstimate),
        }));
      return {
        last7dUsd: usd(last7), last30dUsd: usd(total30), projectedMonthUsd: usd(projected), byStage: sorted(byStage),
        byModel: sorted(byModel), topSubjects: top, cacheHitRatio: javaDouble(Math.round(ratio * 10000) / 10000)!,
        simulated, accuracy: { lastRuns: accuracy },
      };
    });
  }

  /** Everything recorded by pipeline runs since `since` (the weekly cost limit). */
  spentSince(since: Odt): Promise<Dec> {
    return inTx(this.db, () => usage.sumCostSince(since));
  }

  /** Rough cost of requests before submitting them: input tokens plus half of max_tokens as output. */
  async estimate(model: string, mode: string, inputTokens: number, maxOutputTokens: number): Promise<Dec> {
    return cost(await this.models.findById(model), mode, inputTokens, 0, Math.trunc(maxOutputTokens / 2));
  }
}

/** service/kb/admin/KbQuotaService: the admin panel's view of DoQuotaTracker. */
export class KbQuotaService {
  static readonly STALE_AFTER_MIN = 10;

  constructor(private readonly tracker: DoQuotaTracker, private readonly now: Now) {}

  /** refresh is accepted but no longer probes DO (the probe spent a batch creation). */
  get(_refresh: boolean): KbQuotaResponse {
    const at = this.tracker.lastObservedAt();
    const stale = at == null || this.now().isAfter(at.plusMinutes(KbQuotaService.STALE_AFTER_MIN));
    const c = (key: string): KbQuotaCounter | null => {
      const x = this.tracker.counter(key);
      return x == null ? null : { limit: x.limit, remaining: x.remaining };
    };
    return {
      observedAt: odtJson(at),
      batch: {
        creationsPerHour: c('batch-creations-per-hour'), createPerMinute: c('batch-create-per-minute'),
        requestsPerDay: c('batch-requests-per-day'), statusChecksPerMinute: c('batch-status-checks-per-minute'),
      },
      sync: { tokensPerDay: c('tokens-per-day'), tokensPerMinute: c('tokens-per-minute'), requestsPerMinute: c('requests') },
      stale,
    };
  }
}
