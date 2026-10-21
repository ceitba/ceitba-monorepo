// kb-pipeline's collaborators (kb-admin settings/forecast/catalog/evals, kb-reader
// importer) are wired by kbPipeline itself, not by whichever feature's routes ran
// first: a process that never registered the kb-admin or kb-reader routes (a
// jobs-only process, or routes registered in another order) still has them.
import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../../src/config';
import { buildDeps } from '../../src/deps';
import { silentLogger } from '../../src/infra/logger';
import { kbAdmin } from '../../src/features/kb-admin/service';
import { provideKbCollaborators, type KbForecastPort } from '../../src/features/kb-pipeline/collaborators';
import { kbCollaborators, kbPipeline } from '../../src/features/kb-pipeline/service';
import { CONTRACT_ENV } from '../../contract/support/env';

const depsWithoutRoutes = async () =>
  buildDeps(await loadConfig({ ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/x' }), { log: silentLogger, push: null });

describe('kb-pipeline collaborators', () => {
  test('availableWithoutAnyRouteRegistration', async () => {
    const deps = await depsWithoutRoutes();
    const kb = kbPipeline(deps);
    expect(() => kb.forecast()).not.toThrow();
    expect(kb.forecast()).toBe(kbAdmin(deps).forecast);
    expect(kb.settings()).toBe(kbAdmin(deps).settings);
    const c = kbCollaborators(deps);
    expect(c.catalog).toBe(kbAdmin(deps).catalog);
    expect(c.evals).toBe(kbAdmin(deps).evals);
    expect(typeof c.importer?.validate).toBe('function');
    expect(typeof c.importer?.importSubject).toBe('function');
  });

  test('aCollaboratorRegisteredFirstWins', async () => {
    const deps = await depsWithoutRoutes();
    const fake: KbForecastPort = { nextRunTotal: async () => { throw new Error('unused'); }, subjectEstimates: async () => new Map() };
    provideKbCollaborators(deps, { forecast: fake });
    expect(kbPipeline(deps).forecast()).toBe(fake);
  });
});
