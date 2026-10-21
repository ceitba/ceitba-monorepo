// Port of apps/api/src/main/java/org/ceitba/api/service/kb/progress/KbProgressService.java.
//
// Progress of runs and evals (docs/SUBJECT-WIKI-ADMIN.md, "Progress"): one light
// query over the request rows (no payloads; completion time from kb_llm_usage for
// rows recorded before V36), the batch jobs and the run.

import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { ResourceNotFoundError } from '../../http/errors';
import { asInt, elements, has, isEmpty, path } from '../kb/logic/jsonNode';
import type { Now } from '../kb/logic/odt';
import { compute, Job, Row, Run, type KbProgressResponse as ProgressMath } from '../kb/logic/progress/kbProgressMath';
import type { KbRun } from './db/entities';
import { jobs, requests, runs, runSubjects } from './db/repo';
import { inTx, session } from './db/session';
import { jsonOf, odtOf } from './db/values';
import { progressJson, type KbProgressResponse } from './dto';

type R = Record<string, unknown>;
const str = (v: unknown): string | null => (v == null ? null : String(v));

export class KbProgressService {
  constructor(private readonly db: Database, private readonly concurrency: () => number, private readonly now: Now) {}

  /** The progress of a run or eval (404 when it does not exist). */
  progress(runId: string): Promise<KbProgressResponse> {
    return inTx(this.db, async () => progressJson(await this.compute(runId)));
  }

  /** KbProgressMath.compute over the stored state (for callers that need the Odt form). */
  compute(runId: string): Promise<ProgressMath> {
    return inTx(this.db, async () => {
      const run = await runs.findById(runId);
      if (run == null) throw new ResourceNotFoundError('KbRun', runId);
      return compute(await this.state(run), await this.rows(runId), await this.jobs(runId), this.concurrency(), this.now());
    });
  }

  rows(runId: string): Promise<Row[]> {
    return inTx(this.db, async () => (await requests.progressRows(runId)).map((r) => new Row(String(r.stage), String(r.status),
      r.failed_answer === true, Number(r.est_tokens), String(r.model), odtOf(str(r.created_at)), odtOf(str(r.completed_at)),
      r.latency_ms == null ? null : Number(r.latency_ms), String(r.target), String(r.subject_id))));
  }

  state(run: KbRun): Promise<Run> {
    return inTx(this.db, async () => {
      let expectedPlan: number;
      let pubTotal = 0;
      let pubDone = 0;
      let pubFailed = 0;
      if (run.isEval()) {
        const [e] = await session().query<R>(sql`SELECT set_id, configs::text AS configs FROM wiki.kb_eval WHERE id = ${run.id}::uuid`);
        const configs = e ? elements(jsonOf(str(e.configs))).length : 0;
        let subjects = 0;
        if (e) {
          const [set] = await session().query<R>(sql`SELECT subject_ids::text AS subject_ids, frozen_inputs::text AS frozen_inputs
            FROM wiki.kb_eval_set WHERE id = ${String(e.set_id)}::uuid`);
          const frozen = set ? jsonOf(str(set.frozen_inputs)) : null;
          if (set && frozen != null) {
            for (const sId of elements(jsonOf(str(set.subject_ids)))) {
              const key = typeof sId === 'string' ? sId : String(asInt(sId));
              if (!isEmpty(path(frozen, key))) subjects++;
            }
          }
        }
        expectedPlan = configs * subjects;
      } else {
        const subs = await runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(run.id);
        expectedPlan = subs.filter((s) => s.status !== 'DEFERRED').length;
        for (const s of subs) {
          if (s.status === 'DEFERRED' || s.status === 'DRY') continue;
          pubTotal++;
          if (s.status === 'PUBLISHED') pubDone++;
          if (s.status === 'FAILED') pubFailed++;
        }
      }
      return new Run(run.isEval(), run.stage ?? 'DONE', run.status, run.dryRun, run.startedAt, run.finishedAt, run.stageLog,
        expectedPlan, pubTotal, pubDone, pubFailed, run.error);
    });
  }

  private async jobs(runId: string): Promise<Job[]> {
    return (await jobs.findByRunIdOrderByCreatedAtAsc(runId)).map((j) => {
      const c = j.doRequestCounts;
      const hasTotal = c != null && has(c, 'total');
      return new Job(j.stage, j.mode, j.status, j.doStatus, hasTotal ? asInt(path(c, 'total')) : null,
        hasTotal ? asInt(path(c, 'completed')) : null, hasTotal ? asInt(path(c, 'failed')) : null, j.submittedAt,
        j.statusChangedAt, j.completedAt, j.nextAttemptAt, j.error);
    });
  }
}
