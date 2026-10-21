// external/itba/wire/*: the ITBA gateway's JSON, read the way the Java
// RestClient's ObjectMapper reads it (RestClientConfig):
//   ACCEPT_SINGLE_VALUE_AS_ARRAY  every List<> accepts a lone value ("section": {...});
//   FAIL_ON_UNKNOWN_PROPERTIES off / @JsonIgnoreProperties(ignoreUnknown = true);
//   Jackson scalar coercion: a String field takes a JSON number or boolean as its text.
// Anything else Jackson rejects (an object or array where a String goes, a
// scalar where a record goes) throws WireFormatError; the client wraps it in
// ExternalApiError like the Java client wraps every exception.

export class WireFormatError extends Error {}

type Json = unknown;

const isObject = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A Java String field. */
function str(v: Json, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return javaNumberText(v);
  if (typeof v === 'boolean') return String(v);
  throw new WireFormatError(`Cannot deserialize value of type String from ${Array.isArray(v) ? 'Array' : 'Object'} (${field})`);
}

/** Jackson's text of a JSON number coerced to String: integers as written, floats via Double.toString. */
function javaNumberText(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 2 ** 63) return String(n);
  const s = String(n);
  if (/e/i.test(s)) {
    const [m, e] = s.split(/e/i) as [string, string];
    return `${m.includes('.') ? m : `${m}.0`}E${Number(e)}`;
  }
  return s.includes('.') ? s : `${s}.0`;
}

/** A Java record field: null, or an object. */
function rec<T>(v: Json, field: string, read: (o: Record<string, Json>) => T): T | null {
  if (v === undefined || v === null) return null;
  if (!isObject(v)) throw new WireFormatError(`Cannot construct ${field} from ${Array.isArray(v) ? 'Array' : typeof v}`);
  return read(v);
}

/** A List<T> field with ACCEPT_SINGLE_VALUE_AS_ARRAY: a lone value becomes a one-element list. */
function list<T>(v: Json, read: (el: Json) => T | null): (T | null)[] | null {
  if (v === undefined || v === null) return null;
  const items = Array.isArray(v) ? v : [v];
  return items.map((el) => (el === null ? null : read(el)));
}

export interface SubjectEntry {
  type: string | null;
  name: string | null;
  code: string | null;
  credits: string | null;
  dependencies: { dependency: (string | null)[] | null } | null;
  creditsRequired: string | null;
}
export interface Term { year: string | null; period: string | null; entries: { entry: (SubjectEntry | null)[] | null } | null }
export interface Section {
  name: string | null;
  terms: { term: (Term | null)[] | null } | null;
  withoutTerm: { entries: (SubjectEntry | null)[] | null } | null;
}
export interface CareerPlan { name: string | null; career: string | null; degreeLevel: string | null; since: string | null; section: (Section | null)[] | null }
export interface CareerPlansResponse { careerPlan: CareerPlan | null }

const subjectEntry = (o: Record<string, Json>): SubjectEntry => ({
  type: str(o.type, 'type'),
  name: str(o.name, 'name'),
  code: str(o.code, 'code'),
  credits: str(o.credits, 'credits'),
  dependencies: rec(o.dependencies, 'Dependencies', (d) => ({ dependency: list(d.dependency, (x) => str(x, 'dependency')) })),
  creditsRequired: str(o.creditsRequired, 'creditsRequired'),
});
const entryEl = (el: Json) => rec(el, 'SubjectEntry', subjectEntry);

const term = (o: Record<string, Json>): Term => ({
  year: str(o.year, 'year'),
  period: str(o.period, 'period'),
  entries: rec(o.entries, 'Entries', (e) => ({ entry: list(e.entry, entryEl) })),
});

const section = (o: Record<string, Json>): Section => ({
  name: str(o.name, 'name'),
  terms: rec(o.terms, 'Terms', (t) => ({ term: list(t.term, (el) => rec(el, 'Term', term)) })),
  // WithoutTerm(@JsonProperty("withoutTerm") List<SubjectEntry> entries): the inner field has the wrapper's name.
  withoutTerm: rec(o.withoutTerm, 'WithoutTerm', (w) => ({ entries: list(w.withoutTerm, entryEl) })),
});

/** CareerPlansResponse(@JsonProperty("careerplan") CareerPlan careerPlan). `null` body -> null. */
export function readCareerPlans(json: Json): CareerPlansResponse | null {
  if (json === null || json === undefined) return null;
  return rec(json, 'CareerPlansResponse', (o) => ({
    careerPlan: rec(o.careerplan, 'CareerPlan', (p) => ({
      name: str(p.name, 'name'),
      career: str(p.career, 'career'),
      degreeLevel: str(p.degreeLevel, 'degreeLevel'),
      since: str(p.since, 'since'),
      section: list(p.section, (el) => rec(el, 'Section', section)),
    })),
  }));
}

export interface CourseCommissionTime { day: string | null; classRoom: string | null; building: string | null; hourFrom: string | null; hourTo: string | null }
export interface CourseCommission {
  subjectCode: string | null;
  subjectName: string | null;
  subjectType: string | null;
  courseStart: string | null;
  courseEnd: string | null;
  commissionName: string | null;
  commissionId: string | null;
  quota: string | null;
  enrolledStudents: string | null;
  courseCommissionTimes: (CourseCommissionTime | null)[] | null;
}
export interface CourseCommissionsResponse { courseCommissions: { courseCommission: (CourseCommission | null)[] | null } | null }

const commissionTime = (o: Record<string, Json>): CourseCommissionTime => ({
  day: str(o.day, 'day'),
  classRoom: str(o.classRoom, 'classRoom'),
  building: str(o.building, 'building'),
  hourFrom: str(o.hourFrom, 'hourFrom'),
  hourTo: str(o.hourTo, 'hourTo'),
});

const courseCommission = (o: Record<string, Json>): CourseCommission => ({
  subjectCode: str(o.subjectCode, 'subjectCode'),
  subjectName: str(o.subjectName, 'subjectName'),
  subjectType: str(o.subjectType, 'subjectType'),
  courseStart: str(o.courseStart, 'courseStart'),
  courseEnd: str(o.courseEnd, 'courseEnd'),
  commissionName: str(o.commissionName, 'commissionName'),
  commissionId: str(o.commissionId, 'commissionId'),
  quota: str(o.quota, 'quota'),
  enrolledStudents: str(o.enrolledStudents, 'enrolledStudents'),
  courseCommissionTimes: list(o.courseCommissionTimes, (el) => rec(el, 'CourseCommissionTime', commissionTime)),
});

/** CourseCommissionsResponse(CourseCommissions(List<CourseCommission> courseCommission)). */
export function readCourseCommissions(json: Json): CourseCommissionsResponse | null {
  if (json === null || json === undefined) return null;
  return rec(json, 'CourseCommissionsResponse', (o) => ({
    courseCommissions: rec(o.courseCommissions, 'CourseCommissions', (c) => ({
      courseCommission: list(c.courseCommission, (el) => rec(el, 'CourseCommission', courseCommission)),
    })),
  }));
}
