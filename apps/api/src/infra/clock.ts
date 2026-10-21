import { ART, localDateOf, msToMicros, systemNowMicros, type Micros } from '../lib/time';

// config/ClockConfig.java: the single source of "now" for business logic, in
// America/Argentina/Buenos_Aires whatever the host zone. Services call
// clock.now() / clock.today() instead of Date.now(). Tests inject a
// MutableClock and move it (service/mail/MutableClock in the Java tests).

export interface Clock {
  readonly zone: string;
  /** Instant.now(clock), in microseconds since the epoch. */
  now(): Micros;
  /** LocalDate.now(clock): `YYYY-MM-DD` in the clock's zone. */
  today(): string;
}

export class SystemClock implements Clock {
  constructor(readonly zone: string = ART) {}
  now(): Micros {
    return systemNowMicros();
  }
  today(): string {
    return localDateOf(this.now(), this.zone);
  }
}

/** A clock tests can set and advance. */
export class MutableClock implements Clock {
  private current: Micros;
  constructor(start: Micros | Date | string = systemNowMicros(), readonly zone: string = ART) {
    this.current = typeof start === 'number' ? start : msToMicros(new Date(start).getTime());
  }
  now(): Micros {
    return this.current;
  }
  today(): string {
    return localDateOf(this.current, this.zone);
  }
  set(t: Micros | Date | string): void {
    this.current = typeof t === 'number' ? t : msToMicros(new Date(t).getTime());
  }
  advance(ms: number): void {
    this.current += msToMicros(ms);
  }
}
