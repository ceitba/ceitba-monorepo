// Port of apps/api/src/main/java/org/ceitba/api/service/kb/llm/KbPricing.java.
//
// Cost of one request from recorded token usage and a catalog price
// (docs/SUBJECT-WIKI-ADMIN.md §2-3): uncached input at input_per_m, cached
// input at cache_read_per_m (input price when unknown), output at
// output_per_m, all per million tokens; BATCH mode takes batch_discount off.
// Unknown model or price -> 0. Exact decimal arithmetic (BigDecimal semantics).

import { Dec } from '../decimal';
import type { KbModel } from '../types';

const MILLION = Dec.fromInt(1_000_000);

/** Per-million prices actually paid in a mode (ADMIN doc §7). */
export interface Prices {
  inputPerM: Dec | null;
  outputPerM: Dec | null;
  cacheReadPerM: Dec | null;
}

export function effective(model: KbModel | null, mode: string): Prices | null {
  if (model == null) return null;
  const factor = mode === 'BATCH' && model.batchDiscount != null ? Dec.ONE.subtract(model.batchDiscount) : Dec.ONE;
  return {
    inputPerM: scale(model.inputPerM, factor),
    outputPerM: scale(model.outputPerM, factor),
    cacheReadPerM: scale(model.cacheReadPerM, factor),
  };
}

function scale(price: Dec | null, factor: Dec): Dec | null {
  return price == null ? null : price.multiply(factor).setScale(4, 'HALF_UP').stripTrailingZeros();
}

/** input/cached/output are token counts (Java longs; exact as JS integers below 2^53). */
export function cost(model: KbModel | null, mode: string, input: number, cached: number, output: number): Dec {
  if (model == null || model.inputPerM == null || model.outputPerM == null) return Dec.ZERO;
  const c = Math.max(0, Math.min(cached, input));
  const uncached = input - c;
  const cacheRate = model.cacheReadPerM != null ? model.cacheReadPerM : model.inputPerM;
  let total = model.inputPerM
    .multiply(Dec.fromInt(uncached))
    .add(cacheRate.multiply(Dec.fromInt(c)))
    .add(model.outputPerM.multiply(Dec.fromInt(output)));
  if (mode === 'BATCH' && model.batchDiscount != null) {
    total = total.multiply(Dec.ONE.subtract(model.batchDiscount));
  }
  return total.divide(MILLION, 6, 'HALF_UP');
}
