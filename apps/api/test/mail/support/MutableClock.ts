// Port of apps/api/src/test/java/org/ceitba/api/service/mail/MutableClock.java:
// a fake clock tests move by hand (UTC). The foundation already ships one in
// src/infra/clock.ts; this re-exports it with the Java test's zone.
import { MutableClock as InfraMutableClock } from '../../../src/infra/clock';

export class MutableClock extends InfraMutableClock {
  constructor(start: string | number) {
    super(start, 'UTC');
  }
}
