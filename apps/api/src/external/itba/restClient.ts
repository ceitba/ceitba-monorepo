// external/itba/RestClientItbaApiClient + config/RestClientConfig#itbaRestClient:
// the real ITBA gateway client (GET {base}/careerPlans/{token}?plan= and
// GET {base}/courseCommissions/{token}?level=&year=&period=). Every failure
// (connection, HTTP status, body, mapping) becomes ExternalApiError("ITBA", op).

import { ExternalApiError } from '../../http/errors';
import { javaHashCode } from '../../lib/javaCompat';
import type { Clock } from '../../infra/clock';
import type { Logger } from '../../infra/logger';
import {
  type CommissionProjection, type CommissionQuery, type DayOfWeek, type ItbaApiClient, type SubjectPlanProjection,
  type SubjectType, type TimeSlot, withDefaultsFilled,
} from '../itba';
import { readCareerPlans, readCourseCommissions, WireFormatError, type CourseCommission, type Section, type SubjectEntry } from './wire';
import { redactText, redactUrl, scrubError } from '../../lib/redact';

const DAYS: readonly DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const SUBJECT_TYPES: readonly SubjectType[] = ['ANNUAL', 'SEMESTRAL', 'SAMINARY'];

export interface RestItbaOptions { baseUrl: string; token: string; timeoutMs: number }

/** Integer.parseInt: optional sign, ASCII digits, int range; else NumberFormatException. */
export function javaParseInt(s: string | null): number {
  if (s === null) throw new WireFormatError('Cannot parse null string: null');
  if (!/^[+-]?\d+$/.test(s)) throw new WireFormatError(`For input string: "${s}"`);
  const n = Number(s);
  if (n > 2147483647 || n < -2147483648) throw new WireFormatError(`For input string: "${s}"`);
  return n;
}

function parseIntOrNull(s: string | null): number | null {
  if (s === null) return null;
  try {
    return javaParseInt(s);
  } catch {
    return null;
  }
}

/** LocalDate.parse(s, "dd/MM/yy") (ResolverStyle.SMART: a day past the month's end clamps to its last day). */
export function parseItbaDate(s: string | null): string {
  if (s === null) throw new WireFormatError('text');
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(s);
  if (!m) throw new WireFormatError(`Text '${s}' could not be parsed`);
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = 2000 + Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new WireFormatError(`Text '${s}' could not be parsed`);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = Math.min(day, last);
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** LocalTime.parse (ISO_LOCAL_TIME), normalized to `HH:mm:ss[.fraction]` (trailing zeros stripped). */
export function parseIsoLocalTime(s: string | null): string {
  if (s === null) throw new WireFormatError('text');
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?$/.exec(s);
  if (!m) throw new WireFormatError(`Text '${s}' could not be parsed`);
  const frac = (m[4] ?? '').replace(/0+$/, '');
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}${frac ? `.${frac}` : ''}`;
}

/** LocalTime.toString() of a normalized time (the dedup key part). */
function localTimeToString(t: string): string {
  const [hm, rest] = [t.slice(0, 5), t.slice(6)];
  if (rest === '00') return hm;
  const [secs, frac] = rest.split('.') as [string, string | undefined];
  if (!frac) return `${hm}:${secs}`;
  const groups = frac.length <= 3 ? 3 : frac.length <= 6 ? 6 : 9;
  return `${hm}:${secs}.${frac.padEnd(groups, '0')}`;
}

/** String.toUpperCase() in the JVM default (en_US) locale. */
const upper = (s: string) => s.toLocaleUpperCase('en-US');

function normalizeBuilding(building: string | null): string {
  if (building === null) return 'Online';
  switch (building) {
    case 'External': return 'Online';
    case 'Sede Distrito Financiero': return 'SDF';
    case 'Sede Rectorado': return 'SDR';
    default: return building;
  }
}

function mapDay(day: string | null): DayOfWeek {
  if (day === null) return 'MONDAY';
  const u = upper(day);
  return (DAYS as readonly string[]).includes(u) ? (u as DayOfWeek) : 'MONDAY';
}

/** Null when ITBA sends no type or an unknown one (the upsert keeps the stored type). */
function mapSubjectType(type: string | null): SubjectType | null {
  if (type === null) return null;
  const u = upper(type);
  return (SUBJECT_TYPES as readonly string[]).includes(u) ? (u as SubjectType) : null;
}

/**
 * `new HashMap<>()` + putIfAbsent + `List.copyOf(values())`: Java iterates a
 * HashMap by bucket index ((h ^ h >>> 16) & (capacity - 1)), insertion order
 * within a bucket; capacity doubles from 16 while size > 0.75 * capacity.
 */
export function javaHashMapValues<V>(entries: [string, V][]): V[] {
  const unique: [string, V][] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e[0])) continue;
    seen.add(e[0]);
    unique.push(e);
  }
  let capacity = 16;
  while (unique.length > capacity * 0.75) capacity *= 2;
  const bucket = (k: string) => {
    const h = javaHashCode(k);
    return (h ^ (h >>> 16)) & (capacity - 1);
  };
  return unique.map((e, i) => ({ v: e[1], b: bucket(e[0]), i }))
    .sort((a, b) => a.b - b.b || a.i - b.i)
    .map((x) => x.v);
}

/** UriBuilder strict encoding of a URI variable (the token). */
const encodeVar = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** UriComponentsBuilder template encoding of a query parameter value: pchar, '/' and '?' stay, '=' and '&' do not. */
function encodeQueryParam(s: string): string {
  let out = '';
  for (const ch of s) {
    if (/^[A-Za-z0-9\-._~!$'()*+,;:@/?]$/.test(ch)) out += ch;
    else for (const b of new TextEncoder().encode(ch)) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

export class RestItbaApiClient implements ItbaApiClient {
  constructor(private readonly opts: RestItbaOptions, private readonly clock: Clock, private readonly log?: Logger) {}

  private url(path: string, query: [string, string][]): string {
    const base = this.opts.baseUrl.replace(/\/+$/, '');
    const qs = query.map(([k, v]) => `${k}=${encodeQueryParam(v)}`).join('&');
    return `${base}${path}/${encodeVar(this.opts.token)}?${qs}`;
  }

  /** The URL as it may appear in an error or a log: the token (a path segment) masked. */
  private safe(url: string): string {
    return redactUrl(url, [this.opts.token]);
  }

  /**
   * retrieve().body(T.class): 2xx with a JSON body, else an exception. An empty body is null. Errors never carry
   * the token: the URL in messages is masked and a fetch error (whose `path` is the full URL) is scrubbed.
   */
  private async get(url: string): Promise<unknown> {
    let res: Response;
    let text: string;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json, application/*+json' }, signal: AbortSignal.timeout(this.opts.timeoutMs) });
      text = await res.text();
    } catch (e) {
      throw new Error(`I/O error on GET request for "${this.safe(url)}": ${redactText((e as Error)?.message ?? String(e), [this.opts.token])}`,
        { cause: scrubError(e, [this.opts.token]) });
    }
    if (res.status >= 400) throw new Error(`${res.status} ${res.statusText} from GET ${this.safe(url)}`);
    if (text.length === 0) return null;
    const type = (res.headers.get('content-type') ?? 'application/octet-stream').toLowerCase();
    if (!/^application\/(?:[^;]*\+)?json\b/.test(type)) throw new Error(`No HttpMessageConverter for content type [${type}]`);
    return JSON.parse(text);
  }

  async getSubjectsByPlan(planId: string): Promise<SubjectPlanProjection[]> {
    try {
      const response = readCareerPlans(await this.get(this.url('/careerPlans', [['plan', planId]])));
      if (response === null || response.careerPlan === null) throw new ExternalApiError('ITBA', 'getSubjectsByPlan', null);
      const out: SubjectPlanProjection[] = [];
      for (const s of response.careerPlan.section ?? []) {
        if (s === null) throw new WireFormatError('null section');
        this.processSection(s, planId, out);
      }
      return out;
    } catch (e) {
      if (e instanceof ExternalApiError) throw e;
      throw new ExternalApiError('ITBA', 'getSubjectsByPlan', e);
    }
  }

  async getCommissions(query: CommissionQuery): Promise<CommissionProjection[]> {
    const q = withDefaultsFilled(query, this.clock.today());
    const out: CommissionProjection[] = [];
    for (const level of q.levels) {
      try {
        const response = readCourseCommissions(await this.get(this.url('/courseCommissions',
          [['level', level], ['year', String(q.year)], ['period', q.period]])));
        if (response === null || response.courseCommissions === null || response.courseCommissions.courseCommission === null) {
          this.log?.warn({ level }, 'No commission data received for level');
          continue;
        }
        for (const course of response.courseCommissions.courseCommission) {
          if (course === null || course.courseCommissionTimes === null) {
            this.log?.warn({ subject: course?.subjectName ?? null }, 'Skipping course without times');
            continue;
          }
          // Skip 99.52 / 99.56: historically excluded.
          if (course.subjectCode === '99.52' || course.subjectCode === '99.56') continue;
          out.push(this.toCommission(course));
        }
      } catch (e) {
        throw new ExternalApiError('ITBA', `getCommissions(level=${level})`, e);
      }
    }
    return out;
  }

  async getCommissionsBySubject(subjectCode: string, query: CommissionQuery): Promise<CommissionProjection[]> {
    return (await this.getCommissions(query)).filter((c) => c.subjectCode === subjectCode);
  }

  private processSection(section: Section, planId: string, out: SubjectPlanProjection[]) {
    if (section.terms !== null && section.terms.term !== null) {
      for (const term of section.terms.term) {
        if (term === null) throw new WireFormatError('null term');
        if (term.entries === null || term.entries.entry === null) continue;
        for (const entry of term.entries.entry) {
          if (entry === null) throw new WireFormatError('null entry');
          if (entry.type !== 'subject') continue;
          out.push(this.toProjection(entry, planId, section.name, parseIntOrNull(term.year), parseIntOrNull(term.period)));
        }
      }
    } else if (section.withoutTerm !== null && section.withoutTerm.entries !== null) {
      for (const entry of section.withoutTerm.entries) {
        if (entry === null) throw new WireFormatError('null entry');
        if (entry.type !== 'subject') continue;
        out.push(this.toProjection(entry, planId, section.name, null, null));
      }
    }
  }

  private toProjection(entry: SubjectEntry, planId: string, section: string | null, year: number | null, semester: number | null): SubjectPlanProjection {
    const raw = entry.dependencies !== null && entry.dependencies.dependency !== null ? entry.dependencies.dependency : [];
    // List.copyOf rejects null elements.
    if (raw.some((d) => d === null)) throw new WireFormatError('null dependency');
    const creditsRequired = entry.creditsRequired !== null ? javaParseInt(entry.creditsRequired) : null;
    return {
      subjectId: entry.code as string, planId, section, year, semester, dependencies: raw as string[], creditsRequired,
      subjectName: entry.name, subjectCredits: javaParseInt(entry.credits),
    };
  }

  private toCommission(src: CourseCommission): CommissionProjection {
    const times = this.mapTimes(src);
    return {
      id: src.commissionId as string,
      subjectCode: src.subjectCode as string,
      subjectName: src.subjectName,
      commissionName: src.commissionName as string,
      courseStart: parseItbaDate(src.courseStart),
      courseEnd: parseItbaDate(src.courseEnd),
      enrolledStudents: javaParseInt(src.enrolledStudents),
      quota: javaParseInt(src.quota),
      subjectType: mapSubjectType(src.subjectType),
      times,
    };
  }

  /** Dedup by (commissionId, day, hourFrom), the commission_time primary key. */
  private mapTimes(src: CourseCommission): TimeSlot[] {
    const entries: [string, TimeSlot][] = [];
    for (const t of src.courseCommissionTimes ?? []) {
      if (t === null) continue;
      const building = normalizeBuilding(t.building);
      const classroom = t.classRoom !== null ? t.classRoom : 'Virtual Asincrónico';
      const hourFrom = parseIsoLocalTime(t.hourFrom);
      const hourTo = parseIsoLocalTime(t.hourTo);
      const slot: TimeSlot = { day: mapDay(t.day), classroom, building, hourFrom, hourTo };
      entries.push([`${src.commissionId}|${slot.day}|${localTimeToString(hourFrom)}`, slot]);
    }
    return javaHashMapValues(entries);
  }
}
