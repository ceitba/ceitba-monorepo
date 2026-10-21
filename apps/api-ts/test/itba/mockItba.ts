// A stand-in for the ITBA gateway (docs/ITBA-GATEWAY.md) for black-box tests:
// both servers run their REAL client (ITBA_API_USE_FAKE=false) against it, so
// the Java ITs that stage FakeItbaApiClient responses run unchanged on the jar
// and on Bun, and prove the TS client reads the wire format like Java does.
//
//   const itba = startMockItba();                       // module top level: the URL exists before useServer()
//   const api = useServer({ env: itba.env });
//   itba.stubPlan('S10-Rev23', [entry(...), ...]);      // GET /careerPlans/{token}?plan=
//   itba.stubCommissions([commission(...)]);            // GET /courseCommissions/{token}?level=UNDERGRADUATE
//   itba.requests                                       // every path+query received
//
// Unstubbed plans answer a careerplan with no sections (the clients see an
// empty plan); unstubbed levels answer an empty courseCommission list.

export const MOCK_TOKEN = 'tok-123';

export interface PlanEntrySpec {
  code: string;
  name: string | null;
  credits: number | string;
  section: string;
  /** null = an elective under `withoutTerm` (the projection's null year/semester). */
  year: number | null;
  semester: number | null;
  dependencies?: string[];
  creditsRequired?: number | null;
}

export interface CommissionSpec {
  id: string;
  subjectCode: string;
  subjectName?: string | null;
  commissionName?: string | null;
  /** LocalDate `YYYY-MM-DD` (sent as dd/MM/yy). */
  courseStart: string;
  courseEnd: string;
  enrolled?: number;
  quota?: number;
  subjectType?: string | null;
  times?: { day: string; classroom: string | null; building: string | null; from: string; to: string }[];
}

const ddMMyy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;

/** A careerplan body for the entries, grouped by section, then (year, semester) terms in first-seen order. */
export function planBody(planId: string, entries: PlanEntrySpec[]): unknown {
  const sections = new Map<string, PlanEntrySpec[]>();
  for (const e of entries) {
    const l = sections.get(e.section) ?? [];
    l.push(e);
    sections.set(e.section, l);
  }
  const wireEntry = (e: PlanEntrySpec) => ({
    type: 'subject', name: e.name, code: e.code, credits: String(e.credits),
    ...(e.dependencies && e.dependencies.length ? { dependencies: { dependency: e.dependencies.length === 1 ? e.dependencies[0] : e.dependencies } } : {}),
    ...(e.creditsRequired != null ? { creditsRequired: String(e.creditsRequired) } : {}),
  });
  const section = [...sections].map(([name, list]) => {
    if (list.every((e) => e.year === null)) {
      const w = list.map(wireEntry);
      return { name, withoutTerm: { withoutTerm: w.length === 1 ? w[0] : w } };
    }
    const terms = new Map<string, PlanEntrySpec[]>();
    for (const e of list) {
      const k = `${e.year}|${e.semester}`;
      const l = terms.get(k) ?? [];
      l.push(e);
      terms.set(k, l);
    }
    const term = [...terms.values()].map((l) => ({
      year: String(l[0]!.year), period: String(l[0]!.semester),
      entries: { entry: l.length === 1 ? wireEntry(l[0]!) : l.map(wireEntry) },
    }));
    return { name, terms: { term: term.length === 1 ? term[0] : term } };
  });
  return { careerplan: { name: planId, career: planId.slice(0, 1), degreeLevel: 'UNDERGRADUATE', since: '2023', section } };
}

export function commissionWire(c: CommissionSpec): unknown {
  return {
    subjectCode: c.subjectCode,
    ...(c.subjectName !== null ? { subjectName: c.subjectName ?? c.subjectCode } : {}),
    ...(c.subjectType !== null ? { subjectType: c.subjectType ?? 'SEMESTRAL' } : {}),
    courseStart: ddMMyy(c.courseStart),
    courseEnd: ddMMyy(c.courseEnd),
    ...(c.commissionName !== null ? { commissionName: c.commissionName ?? 'A' } : {}),
    commissionId: c.id,
    quota: String(c.quota ?? 30),
    enrolledStudents: String(c.enrolled ?? 0),
    courseCommissionTimes: (c.times ?? []).map((t) => ({
      day: t.day, ...(t.classroom !== null ? { classRoom: t.classroom } : {}), ...(t.building !== null ? { building: t.building } : {}),
      hourFrom: t.from, hourTo: t.to,
    })),
  };
}

export interface MockItba {
  url: string;
  env: Record<string, string>;
  requests: string[];
  stubPlan(planId: string, entries: PlanEntrySpec[]): void;
  stubPlanBody(planId: string, body: unknown, status?: number): void;
  stubCommissions(list: CommissionSpec[], level?: string): void;
  stubCommissionsBody(level: string, body: unknown, status?: number): void;
  reset(): void;
  stop(): void;
}

export function startMockItba(): MockItba {
  const plans = new Map<string, { body: unknown; status: number }>();
  const commissions = new Map<string, { body: unknown; status: number }>();
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const url = new URL(req.url);
      requests.push(url.pathname + url.search);
      const reply = (r: { body: unknown; status: number }) => new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
      if (url.pathname === `/careerPlans/${MOCK_TOKEN}`) {
        const plan = url.searchParams.get('plan') ?? '';
        return reply(plans.get(plan) ?? { body: planBody(plan, []), status: 200 });
      }
      if (url.pathname === `/courseCommissions/${MOCK_TOKEN}`) {
        const level = url.searchParams.get('level') ?? '';
        return reply(commissions.get(level) ?? { body: { courseCommissions: { courseCommission: [] } }, status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  return {
    url,
    env: { ITBA_API_USE_FAKE: 'false', ITBA_API_BASE_URL: url, ITBA_API_TOKEN: MOCK_TOKEN, ITBA_API_TIMEOUT: '10000' },
    requests,
    stubPlan: (planId, entries) => { plans.set(planId, { body: planBody(planId, entries), status: 200 }); },
    stubPlanBody: (planId, body, status = 200) => { plans.set(planId, { body, status }); },
    stubCommissions: (list, level = 'UNDERGRADUATE') => {
      const wire = list.map(commissionWire);
      commissions.set(level, { body: { courseCommissions: { courseCommission: wire.length === 1 ? wire[0] : wire } }, status: 200 });
    },
    stubCommissionsBody: (level, body, status = 200) => { commissions.set(level, { body, status }); },
    reset: () => { plans.clear(); commissions.clear(); requests.length = 0; },
    stop: () => { server.stop(true); },
  };
}

/** Today in ART (the servers' ClockConfig zone) as `YYYY-MM-DD`. */
export function todayArt(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const epochDay = (d: string) => Math.floor(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000);
const ofEpochDay = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/**
 * Rebases the dates of an IT written against a fixed clock (`itToday`) onto
 * the real ART today: same distances to today, so term windows and "ended"
 * checks behave the same on a jar that runs on real time.
 */
export function rebase(itToday: string): (d: string) => string {
  const offset = epochDay(todayArt()) - epochDay(itToday);
  return (d) => ofEpochDay(epochDay(d) + offset);
}
