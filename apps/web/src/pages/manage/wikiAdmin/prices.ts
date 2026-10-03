import { effectivePrices, type ExecutionMode, type KbModel } from '../../../api/kbAdmin'

// Per-1M price with at most 3 decimals ('?' when unknown).
export const priceNum = (v: number | null | undefined) => (v == null ? '?' : String(+v.toFixed(3)))

// Plain-text effective price for <option> labels (no markup there).
export function priceText(m: KbModel, mode?: ExecutionMode): string {
  const { prices, batched } = effectivePrices(m, mode)
  return `$${priceNum(prices.inputPerM)}/$${priceNum(prices.outputPerM)}${batched ? ` batch −${Math.round((m.batchDiscount ?? 0.5) * 100)}%` : ' sync'}`
}
