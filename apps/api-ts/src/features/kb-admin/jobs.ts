// The kb-admin part of scheduling/KbPipelineJob.onStartup (ApplicationReadyEvent): the
// "Básico" benchmark set is created at startup with whichever of its subjects exist
// (KbEvalService.ensureDefaultSet). Java runs it on every startup, with no JobLock.

import { defineJobs } from '../../jobs/scheduler';
import { kbAdmin } from './service';

export default defineJobs((deps) => [{
  name: 'KbPipelineJob#onStartup.ensureDefaultSet',
  enabled: true,
  // Once, right after startup (a startup hook as a job: the period is never reached in practice).
  schedule: { fixedDelayMs: 2_147_000_000, initialDelayMs: 0 },
  run: () => kbAdmin(deps).evals.ensureDefaultSet(),
}]);
