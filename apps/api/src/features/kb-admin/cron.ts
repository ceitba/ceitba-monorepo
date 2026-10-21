// org.springframework.scheduling.support.CronExpression (Spring 6.1), the parts the
// kb settings use: isValidExpression (KbSettingsService.validate) and next()
// (KbForecastService.runsPerWeek). Six fields, seconds first:
//   second minute hour day-of-month month day-of-week
// macros @yearly @annually @monthly @weekly @daily @midnight @hourly; names
// JAN-DEC / SUN-SAT (case-insensitive, replaced in the field text like Spring's
// replaceOrdinals, so "SUNDAY" is invalid); '?' in the day fields; ranges, lists,
// steps; Quartz extras L, L-n, nW, LW (day of month) and nL, n#k (day of week).
// Day-of-week 0 and 7 are Sunday. A date matches when BOTH day fields match
// (Spring, unlike Vixie cron). src/jobs/scheduler.ts runs croner with
// domAndDow for the same reason; croner's parser accepts more than Spring's, so
// validation is ported here.

import { zoneOffsetAt } from '../kb/logic/odt';

const MACROS: Record<string, string> = {
  '@yearly': '0 0 0 1 1 *',
  '@annually': '0 0 0 1 1 *',
  '@monthly': '0 0 0 1 * *',
  '@weekly': '0 0 0 * * 0',
  '@daily': '0 0 0 * * *',
  '@midnight': '0 0 0 * * *',
  '@hourly': '0 0 * * * *',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

class CronError extends Error {}

type Range = [number, number];

/** A plain field: the set of allowed values. */
function bits(value: string, min: number, max: number): Set<number> {
  if (value === '') throw new CronError('empty field');
  const out = new Set<number>();
  for (const part of value.split(',')) {
    const slash = part.indexOf('/');
    let range: Range;
    let step = 1;
    if (slash < 0) {
      range = parseRange(part, min, max);
    } else {
      const r = part.slice(0, slash);
      const d = part.slice(slash + 1);
      range = parseRange(r, min, max);
      if (!r.includes('-') && r !== '*') range = [range[0], max];
      step = parseNumber(d);
      if (step <= 0) throw new CronError('Incrementer delta must be 1 or higher');
    }
    for (let v = range[0]; v <= range[1]; v += step) out.add(v);
  }
  return out;
}

function parseNumber(s: string): number {
  if (!/^\d+$/.test(s)) throw new CronError(`not a number: ${s}`);
  return Number(s);
}

function parseRange(value: string, min: number, max: number): Range {
  if (value === '*') return [min, max];
  const dash = value.indexOf('-');
  if (dash < 0) {
    const v = check(parseNumber(value), min, max);
    return [v, v];
  }
  const a = check(parseNumber(value.slice(0, dash)), min, max);
  const b = check(parseNumber(value.slice(dash + 1)), min, max);
  if (a > b) throw new CronError('Minimum value must be less than maximum value');
  return [a, b];
}

function check(v: number, min: number, max: number): number {
  if (v < min || v > max) throw new CronError(`value ${v} out of range [${min}, ${max}]`);
  return v;
}

function replaceOrdinals(value: string, names: string[]): string {
  let v = value.toUpperCase();
  names.forEach((n, i) => {
    v = v.replaceAll(n, String(names === MONTHS ? i + 1 : i));
  });
  return v;
}

interface Local {
  year: number;
  month: number; // 1-12
  day: number;
  dow: number; // 1 = Monday ... 7 = Sunday (java.time)
}

type DayMatcher = (d: Local) => boolean;

const daysIn = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dowOf = (y: number, m: number, d: number): number => {
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return js === 0 ? 7 : js;
};

function daysOfMonth(value: string): DayMatcher {
  const v = value === '?' ? '*' : value;
  if (v.includes('L') || v.includes('W')) return quartzDaysOfMonth(v);
  const set = bits(v, 1, 31);
  return (d) => set.has(d.day);
}

function quartzDaysOfMonth(v: string): DayMatcher {
  const parts = v.split(',');
  const matchers = parts.map((p): DayMatcher => {
    if (p === 'L') return (d) => d.day === daysIn(d.year, d.month);
    if (p === 'LW') {
      return (d) => d.day === weekdayNear(d.year, d.month, daysIn(d.year, d.month));
    }
    let m = /^L-(\d+)$/.exec(p);
    if (m) {
      const off = Number(m[1]);
      if (off > 30) throw new CronError('offset too large');
      return (d) => d.day === daysIn(d.year, d.month) - off;
    }
    m = /^(\d+)W$/.exec(p);
    if (m) {
      const day = check(Number(m[1]), 1, 31);
      return (d) => day <= daysIn(d.year, d.month) && d.day === weekdayNear(d.year, d.month, day);
    }
    if (p.includes('L') || p.includes('W')) throw new CronError(`bad day of month: ${p}`);
    const set = bits(p, 1, 31);
    return (d) => set.has(d.day);
  });
  return (d) => matchers.some((f) => f(d));
}

/** The weekday (Mon-Fri) nearest to `day` within the month. */
function weekdayNear(y: number, m: number, day: number): number {
  const dow = dowOf(y, m, day);
  if (dow === 6) return day === 1 ? 3 : day - 1;
  if (dow === 7) return day === daysIn(y, m) ? day - 2 : day + 1;
  return day;
}

/** Day of week in Spring numbering (0 or 7 = Sunday, 1 = Monday) to java.time (7 = Sunday). */
const javaDow = (n: number): number => (n === 0 ? 7 : n);

function daysOfWeek(value: string): DayMatcher {
  const v0 = replaceOrdinals(value, DAYS);
  const v = v0 === '?' ? '*' : v0;
  if (v.includes('L') || v.includes('#')) {
    const matchers = v.split(',').map((p): DayMatcher => {
      let m = /^(\d)L$/.exec(p);
      if (m) {
        const dow = javaDow(check(Number(m[1]), 0, 7));
        return (d) => d.dow === dow && d.day + 7 > daysIn(d.year, d.month);
      }
      m = /^(\d)#(\d)$/.exec(p);
      if (m) {
        const dow = javaDow(check(Number(m[1]), 0, 7));
        const nth = Number(m[2]);
        if (nth < 1 || nth > 5) throw new CronError('ordinal out of range');
        return (d) => d.dow === dow && Math.floor((d.day - 1) / 7) + 1 === nth;
      }
      if (p === 'L') throw new CronError('L without a day');
      const set = bits(p, 0, 7);
      return (d) => set.has(d.dow) || (d.dow === 7 && set.has(0));
    });
    return (d) => matchers.some((f) => f(d));
  }
  const set = bits(v, 0, 7);
  return (d) => set.has(d.dow) || (d.dow === 7 && set.has(0));
}

export class SpringCron {
  private constructor(
    private readonly seconds: Set<number>,
    private readonly minutes: Set<number>,
    private readonly hours: Set<number>,
    private readonly dom: DayMatcher,
    private readonly months: Set<number>,
    private readonly dow: DayMatcher,
  ) {}

  /** CronExpression.parse: throws on anything Spring rejects. */
  static parse(expression: string): SpringCron {
    if (expression == null || expression.trim() === '') throw new CronError('Expression string must not be empty');
    const expr = MACROS[expression.toLowerCase()] ?? expression;
    // StringUtils.tokenizeToStringArray(expression, " "): split on spaces, trim tokens, drop empty ones.
    const fields = expr.split(' ').map((t) => t.trim()).filter((t) => t !== '');
    if (fields.length !== 6) throw new CronError(`Cron expression must consist of 6 fields (found ${fields.length} in "${expr}")`);
    try {
      return new SpringCron(
        bits(fields[0]!, 0, 59),
        bits(fields[1]!, 0, 59),
        bits(fields[2]!, 0, 23),
        daysOfMonth(fields[3]!),
        bits(replaceOrdinals(fields[4]!, MONTHS), 1, 12),
        daysOfWeek(fields[5]!),
      );
    } catch (e) {
      if (e instanceof CronError) throw e;
      throw new CronError(String(e));
    }
  }

  static isValidExpression(expression: string | null | undefined): boolean {
    if (expression == null) return false;
    try {
      SpringCron.parse(expression);
      return true;
    } catch {
      return false;
    }
  }

  private dateMatches(l: Local): boolean {
    return this.months.has(l.month) && this.dom(l) && this.dow(l);
  }

  /**
   * How many times `t = next(t)` fires strictly after `from` and strictly before `end`
   * (epoch second + nano), at most `cap`: Java's runsPerWeek loop. next() returns whole
   * seconds after `from`, so a fire counts when its second is > from's second and it is
   * before `end`.
   */
  countFires(fromEpochSecond: number, endEpochSecond: number, endNano: number, zone: string, cap: number): number {
    let n = 0;
    let t = Math.floor(fromEpochSecond / 60) * 60;
    while (t <= endEpochSecond && n < cap) {
      // One local day at a time (its offset read once).
      const off = zoneOffsetAt(t, zone);
      const local = new Date((t + off) * 1000);
      const y = local.getUTCFullYear();
      const m = local.getUTCMonth() + 1;
      const d = local.getUTCDate();
      const dayEnd = Date.UTC(y, m - 1, d + 1) / 1000 - off;
      if (!this.dateMatches({ year: y, month: m, day: d, dow: dowOf(y, m, d) })) {
        t = dayEnd;
        continue;
      }
      for (; t < dayEnd && t <= endEpochSecond && n < cap; t += 60) {
        const l = new Date((t + off) * 1000);
        if (!this.hours.has(l.getUTCHours()) || !this.minutes.has(l.getUTCMinutes())) continue;
        const base = t - l.getUTCSeconds();
        for (let s = 0; s < 60 && n < cap; s++) {
          if (!this.seconds.has(s)) continue;
          const x = base + s;
          if (x <= fromEpochSecond) continue;
          if (x > endEpochSecond || (x === endEpochSecond && endNano === 0)) continue;
          n++;
        }
      }
    }
    return n;
  }
}
