// Port of apps/api/src/main/java/org/ceitba/api/service/digest/personal/CorrectionPrompts.java.
//
// Which schedule corrections a reader is asked about: PENDING ones on one of
// the reader's own commissions, that the reader did not suggest and has not
// voted on. Most confirmed first, then oldest (createdAt, nulls last), then
// id (UUID.compareTo: signed 64-bit halves); at most `cap`.

import { compareUuid } from '../../../../lib/javaCompat';
import type { ScheduleCorrectionRow } from './types';

export function correctionOrder(a: ScheduleCorrectionRow, b: ScheduleCorrectionRow): number {
  if (a.confirmCount !== b.confirmCount) return b.confirmCount - a.confirmCount;
  if (a.createdAt !== b.createdAt) {
    if (a.createdAt == null) return 1;
    if (b.createdAt == null) return -1;
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  if (a.id !== b.id) {
    if (a.id == null) return 1;
    if (b.id == null) return -1;
    return compareUuid(a.id, b.id);
  }
  return 0;
}

export function selectCorrectionPrompts<C extends ScheduleCorrectionRow>(readerId: string, readerCommissionIds: ReadonlySet<string>,
                                                                         candidates: Iterable<C>, votedByReader: ReadonlySet<string>,
                                                                         cap: number): C[] {
  if (cap <= 0 || readerCommissionIds.size === 0) return [];
  return [...candidates]
    .filter((c) => c.status === 'PENDING')
    .filter((c) => readerCommissionIds.has(c.commissionId))
    .filter((c) => readerId !== c.suggesterId)
    .filter((c) => !votedByReader.has(c.id))
    .sort(correctionOrder) // Array.prototype.sort is stable, like Stream.sorted
    .slice(0, cap);
}
