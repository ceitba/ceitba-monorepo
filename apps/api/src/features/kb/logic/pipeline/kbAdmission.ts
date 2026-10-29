// Port of apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/KbAdmission.java.
//
// Which dirty subjects a run takes on (docs/SUBJECT-WIKI-PIPELINE.md, "Cost
// budget and admission"). Candidates are sorted smallest estimated cost first
// (ties: oldest dirty first, i.e. never compiled, then oldest compiledAt, then
// id) and admitted while their whole end-to-end estimate fits the remaining
// cost budget (and the secondary token budget). Exception: when even the first
// candidate does not fit, it is admitted alone (a dedicated run), so a huge
// subject is not starved forever.

import { Dec } from '../decimal';
import type { Odt } from '../odt';

/** dirtySince: when the subject was last compiled (null = never = oldest). */
export interface Candidate {
  subjectId: string;
  costUsd: Dec;
  inputTokens: number;
  dirtySince: Odt | null;
}

/** oversized: the subject admitted alone because it exceeds the budget (or null). */
export class Result {
  constructor(readonly admitted: Candidate[], readonly deferred: Candidate[], readonly oversized: Candidate | null) {}

  admittedUsd(): Dec {
    return sum(this.admitted);
  }

  deferredUsd(): Dec {
    return sum(this.deferred);
  }
}

/** costUsd, then dirtySince (nulls first, OffsetDateTime.compareTo), then subjectId (String.compareTo). */
export function order(a: Candidate, b: Candidate): number {
  const c = a.costUsd.compareTo(b.costUsd);
  if (c !== 0) return c;
  if (a.dirtySince == null || b.dirtySince == null) {
    if (a.dirtySince == null && b.dirtySince != null) return -1;
    if (a.dirtySince != null && b.dirtySince == null) return 1;
  } else {
    const d = a.dirtySince.compareTo(b.dirtySince);
    if (d !== 0) return d;
  }
  return a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0;
}

export function admit(candidates: Candidate[], budgetUsd: Dec, tokenBudget: number): Result {
  const sorted = [...candidates].sort(order);
  const admitted: Candidate[] = [];
  const deferred: Candidate[] = [];
  let usd = Dec.ZERO;
  let tokens = 0;
  let oversized: Candidate | null = null;
  for (const c of sorted) {
    if (oversized != null) {
      deferred.push(c);
      continue;
    }
    const fits = usd.add(c.costUsd).compareTo(budgetUsd) <= 0 && tokens + c.inputTokens <= tokenBudget;
    if (fits) {
      admitted.push(c);
      usd = usd.add(c.costUsd);
      tokens += c.inputTokens;
    } else if (admitted.length === 0) {
      oversized = c;
      admitted.push(c);
    } else {
      deferred.push(c);
    }
  }
  return new Result(admitted, deferred, oversized);
}

function sum(list: Candidate[]): Dec {
  let t = Dec.ZERO;
  for (const c of list) t = t.add(c.costUsd);
  return t;
}
