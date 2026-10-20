// The pure statics of apps/api/src/main/java/org/ceitba/api/service/kb/admin/KbForecastService.java
// (basis, blend, weekly, quantiles, usd, stageModel).
// TODO(kb-service): forecast()/nextRun/snapshot (catalog, dirty subjects, usage history,
// token ratios), runsPerWeek (needs a Spring-compatible CronExpression over ART), settingsHash.

import { Dec } from '../decimal';
import type { KbEffectiveSettings } from './kbSettings';

export const DEFAULT_OUTPUT: Record<string, number> = { DIGEST: 600, PLAN: 1500, WRITE: 2500, RETRY: 2500 };
export const STAGES = ['DIGEST', 'PLAN', 'WRITE', 'RETRY'] as const;
export const WEEKS_PER_MONTH = Dec.parse('4.345');
export const OVERHEAD = 1500;
export const DIGEST_TOKENS_PER_FILE = 800;

/** web/kb/admin/KbForecastResponse.Weekly. */
export interface Weekly {
  expectedUsd: Dec;
  low: Dec;
  high: Dec;
  basis: string;
  runsUsed: number;
  includesBacklog: boolean;
}

export function usd(v: Dec | null): Dec {
  return (v ?? Dec.ZERO).setScale(4, 'HALF_UP');
}

/**
 * A week can't cost less than the pending backlog (`floor`, the next run's total
 * when there are dirty subjects): the range is raised to it and includesBacklog set.
 */
export function weekly(expected: Dec, low: Dec, high: Dec, floor: Dec, basis: string, runs: number): Weekly {
  const backlog = floor.signum() > 0 && expected.compareTo(floor) < 0;
  return {
    expectedUsd: usd(expected.max(floor)),
    low: usd(low.max(floor)),
    high: usd(high.max(floor)),
    basis,
    runsUsed: runs,
    includesBacklog: backlog,
  };
}

/** history with >= 3 runs, corpus with none, blend in between. */
export function basis(runs: number): 'history' | 'corpus' | 'blend' {
  if (runs >= 3) return 'history';
  if (runs === 0) return 'corpus';
  return 'blend';
}

export function blend(history: Dec, corpus: Dec, historyWeight: Dec): Dec {
  return history.multiply(historyWeight).add(corpus.multiply(Dec.ONE.subtract(historyWeight)));
}

/** p25, median, p75 (zeros when empty). */
export function quantiles(values: Dec[]): [Dec, Dec, Dec] {
  if (values.length === 0) return [Dec.ZERO, Dec.ZERO, Dec.ZERO];
  const sorted = [...values].sort((a, b) => a.compareTo(b));
  return [quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75)];
}

function quantile(sorted: Dec[], q: number): Dec {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = Dec.fromDouble(pos - lo);
  return sorted[lo]!.add(sorted[hi]!.subtract(sorted[lo]!).multiply(frac));
}

export function stageModel(s: KbEffectiveSettings, stage: string, subjectId: string | null): string {
  switch (stage) {
    case 'DIGEST':
      return s.modelDigest;
    case 'PLAN':
      return subjectId == null ? s.modelPlan : s.planModelFor(subjectId);
    case 'RETRY':
      return subjectId == null ? s.modelRetry : s.retryModelFor(subjectId);
    default:
      return subjectId == null ? s.modelWrite : s.writeModelFor(subjectId);
  }
}
