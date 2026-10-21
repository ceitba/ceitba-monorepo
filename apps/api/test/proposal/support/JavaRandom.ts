// java.util.Random (the 48-bit LCG), so `new Random(42)` gives Java's sequence.
import type { RandomIntSource } from '../../../src/features/proposal/logic/proposalAliasGenerator';

const MULT = 0x5deece66dn;
const MASK = (1n << 48n) - 1n;

export class JavaRandom implements RandomIntSource {
  private seed: bigint;
  constructor(seed: number) {
    this.seed = (BigInt(seed) ^ MULT) & MASK;
  }
  private next(bits: number): number {
    this.seed = (this.seed * MULT + 0xbn) & MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }
  nextInt(bound: number): number {
    if (bound <= 0) throw new Error('bound must be positive');
    let r = this.next(31);
    const m = bound - 1;
    if ((bound & m) === 0) return Number((BigInt(bound) * BigInt(r)) >> 31n);
    // for (int u = r; u - (r = u % bound) + m < 0; u = next(31)): the < 0 is int overflow.
    for (let u = r; u - (r = u % bound) + m > 2147483647; u = this.next(31));
    return r;
  }
}
