// KbBatchSubmitterTest.MutableClock / the Java tests' fixed-or-movable java.time.Clock, as a `Now`.
import { Odt } from '../../../src/features/kb/logic/odt';

export class MutableClock {
  private current: Odt;

  constructor(start: Odt | string) {
    this.current = typeof start === 'string' ? Odt.parse(start) : start;
  }

  /** OffsetDateTime.now(clock) at UTC. */
  now = (): Odt => this.current.withOffset(0);

  advanceSeconds(s: number): void {
    this.current = this.current.plusSeconds(s);
  }

  set(t: Odt): void {
    this.current = t;
  }
}
