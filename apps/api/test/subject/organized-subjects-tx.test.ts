// In-process port of OrganizedSubjectsIT.externalItbaCallRunsOutsideAnyTransaction
// (apps/api/src/test/java/org/ceitba/api/web/subject/OrganizedSubjectsIT.java):
// the ITBA plan call can take the client's 30 s timeout, so it must not run
// inside a DB transaction. The recording fake checks, during the call, that no
// session of the app's database is `idle in transaction`.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { FakeItbaApiClient, type SubjectPlanProjection } from '../../src/external/itba';
import { testApp, type TestApp } from '../support/app';

class RecordingFakeItbaApiClient extends FakeItbaApiClient {
  txActiveDuringLastPlanCall: boolean | null = null;
  probe: (() => Promise<boolean>) | null = null;
  override async getSubjectsByPlan(planId: string): Promise<SubjectPlanProjection[]> {
    this.txActiveDuringLastPlanCall = this.probe ? await this.probe() : null;
    return super.getSubjectsByPlan(planId);
  }
}

const fake = new RecordingFakeItbaApiClient();
let t: TestApp;
beforeAll(async () => {
  t = await testApp({ overrides: { itba: fake } });
  fake.probe = async () => {
    const [row] = await t.sql`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`;
    return row!.n > 0;
  };
}, 60_000);
afterAll(async () => { await t?.close(); });

test('externalItbaCallRunsOutsideAnyTransaction', async () => {
  fake.stubPlan('S10-Rev23', [{ subjectId: '93.12', planId: 'S10-Rev23', section: 'Ciclo Básico', year: 1, semester: 1,
    dependencies: [], creditsRequired: null, subjectName: 'Algoritmos', subjectCredits: 6 }]);
  fake.txActiveDuringLastPlanCall = null;
  const r = await t.request('GET', '/v1/subjects?plan=S10-Rev23');
  expect(r.status).toBe(200);
  expect(fake.txActiveDuringLastPlanCall as boolean | null).toBe(false);
});
