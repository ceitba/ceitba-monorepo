// The Spring Data repositories the pipeline uses (repository/kb/*, DriveFileRepository,
// SubjectRepository), over the current Session (db/session.ts). Every function
// must run inside inTx. Rows become managed entities where Java loads entities.

import { sql } from 'drizzle-orm';
import { Dec } from '../../kb/logic/decimal';
import type { Odt } from '../../kb/logic/odt';
import type { KbBatchJob, KbRunRequest } from '../../kb/logic/types';
import {
  DIGEST_COLUMNS, JOB_COLUMNS, PAGE_COLUMNS, REQUEST_COLUMNS, RUN_COLUMNS, RUN_SUBJECT_COLUMNS,
  digestMapper, digestOf, jobMapper, jobOf, jvmNow, pageMapper, pageOf, requestMapper, requestOf, runMapper, runOf,
  runSubjectMapper, runSubjectOf, stateMapper, stateOf,
  type KbFileDigest, type KbPageView, type KbRun, type KbRunSubject, type KbSubjectState,
} from './entities';
import { anyOf, session, type Mapper } from './session';
import { decOf, jsonOf, odtOf, pgTime } from './values';

type Row = Record<string, unknown>;

function hydrate<E>(rows: Row[], mapper: Mapper<E>, of: (r: Row) => E): E[] {
  const s = session();
  return rows.map((r) => s.manage(mapper, of(r)));
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

// ---- KbRunRepository ---------------------------------------------------------------------

export const runs = {
  async findById(id: string): Promise<KbRun | null> {
    const s = session();
    const m = s.find(runMapper, id);
    if (m) return m;
    const rows = await s.query<Row>(sql`SELECT ${RUN_COLUMNS} FROM wiki.kb_run WHERE id = ${id}::uuid`);
    return hydrate(rows, runMapper, runOf)[0] ?? null;
  },
  /** PESSIMISTIC_WRITE: SELECT ... FOR UPDATE (the managed instance when already loaded). */
  async lockById(id: string): Promise<KbRun | null> {
    const s = session();
    const rows = await s.query<Row>(sql`SELECT ${RUN_COLUMNS} FROM wiki.kb_run WHERE id = ${id}::uuid FOR UPDATE`);
    return hydrate(rows, runMapper, runOf)[0] ?? null;
  },
  async findByStatusIn(statuses: readonly string[]): Promise<KbRun[]> {
    return hydrate(await session().query<Row>(sql`SELECT ${RUN_COLUMNS} FROM wiki.kb_run WHERE status = ${anyOf(statuses)}`),
      runMapper, runOf);
  },
  async findByStatusInAndTriggerNot(statuses: readonly string[], trigger: string): Promise<KbRun[]> {
    return hydrate(await session().query<Row>(sql`SELECT ${RUN_COLUMNS} FROM wiki.kb_run
      WHERE status = ${anyOf(statuses)} AND trigger <> ${trigger}`), runMapper, runOf);
  },
  async findByStatusInAndTrigger(statuses: readonly string[], trigger: string): Promise<KbRun[]> {
    return hydrate(await session().query<Row>(sql`SELECT ${RUN_COLUMNS} FROM wiki.kb_run
      WHERE status = ${anyOf(statuses)} AND trigger = ${trigger}`), runMapper, runOf);
  },
  async findByTriggerNotOrderByStartedAtDesc(trigger: string, limit: number): Promise<KbRun[]> {
    return hydrate(await session().query<Row>(sql`SELECT ${RUN_COLUMNS} FROM wiki.kb_run WHERE trigger <> ${trigger}
      ORDER BY started_at DESC LIMIT ${limit}`), runMapper, runOf);
  },
  async findFirstByTriggerOrderByStartedAtDesc(trigger: string): Promise<KbRun | null> {
    return hydrate(await session().query<Row>(sql`SELECT ${RUN_COLUMNS} FROM wiki.kb_run WHERE trigger = ${trigger}
      ORDER BY started_at DESC LIMIT 1`), runMapper, runOf)[0] ?? null;
  },
  async save(run: KbRun): Promise<KbRun> {
    return session().persist(runMapper, run);
  },
  /** Conditional status change; 1 = changed. Bulk JPQL: managed instances are not refreshed. */
  setStatusIf(id: string, status: string, from: readonly string[]): Promise<number> {
    return session().update(sql`UPDATE wiki.kb_run SET status = ${status} WHERE id = ${id}::uuid AND status = ${anyOf(from)}`);
  },
  takeLease(id: string, owner: string, until: Odt, now: Odt): Promise<number> {
    return session().update(sql`UPDATE wiki.kb_run SET lease_owner = ${owner}, lease_until = ${pgTime(until)}::timestamptz
      WHERE id = ${id}::uuid AND (lease_owner IS NULL OR lease_until < ${pgTime(now)}::timestamptz OR lease_owner = ${owner})`);
  },
  releaseLease(id: string, owner: string): Promise<number> {
    return session().update(sql`UPDATE wiki.kb_run SET lease_owner = NULL, lease_until = NULL
      WHERE id = ${id}::uuid AND lease_owner = ${owner}`);
  },
  countResume(id: string, now: Odt, cutoff: Odt): Promise<number> {
    const c = pgTime(cutoff);
    return session().update(sql`UPDATE wiki.kb_run SET
      resume_count = CASE WHEN resume_window_start IS NULL OR resume_window_start < ${c}::timestamptz THEN 1 ELSE resume_count + 1 END,
      resume_window_start = CASE WHEN resume_window_start IS NULL OR resume_window_start < ${c}::timestamptz
        THEN ${pgTime(now)}::timestamptz ELSE resume_window_start END
      WHERE id = ${id}::uuid`);
  },
  async resumeCount(id: string): Promise<number> {
    const [r] = await session().query<Row>(sql`SELECT resume_count FROM wiki.kb_run WHERE id = ${id}::uuid`);
    return num(r?.resume_count);
  },
  resetResumes(id: string): Promise<number> {
    return session().update(sql`UPDATE wiki.kb_run SET resume_count = 0, resume_window_start = NULL
      WHERE id = ${id}::uuid AND resume_count <> 0`);
  },
};

// ---- KbRunSubjectRepository -------------------------------------------------------------------

export const runSubjects = {
  async findByRunIdOrderByPriorityDescSubjectIdAsc(runId: string): Promise<KbRunSubject[]> {
    return hydrate(await session().query<Row>(sql`SELECT ${RUN_SUBJECT_COLUMNS} FROM wiki.kb_run_subject
      WHERE run_id = ${runId}::uuid ORDER BY priority DESC, subject_id ASC`), runSubjectMapper, runSubjectOf);
  },
  async findById(runId: string, subjectId: string): Promise<KbRunSubject | null> {
    const s = session();
    const m = s.find(runSubjectMapper, `${runId}|${subjectId}`);
    if (m) return m;
    return hydrate(await s.query<Row>(sql`SELECT ${RUN_SUBJECT_COLUMNS} FROM wiki.kb_run_subject
      WHERE run_id = ${runId}::uuid AND subject_id = ${subjectId}`), runSubjectMapper, runSubjectOf)[0] ?? null;
  },
  save(rs: KbRunSubject): Promise<KbRunSubject> {
    const s = session();
    return s.find(runSubjectMapper, runSubjectMapper.key(rs)) ? Promise.resolve(rs) : s.persist(runSubjectMapper, rs);
  },
};

// ---- KbRunRequestRepository ----------------------------------------------------------------------

const ids = (rows: Row[], col = 'custom_id'): string[] => rows.map((r) => String(r[col]));

export const requests = {
  async findById(customId: string): Promise<KbRunRequest | null> {
    const s = session();
    const m = s.find(requestMapper, customId);
    if (m) return m;
    return hydrate(await s.query<Row>(sql`SELECT ${REQUEST_COLUMNS} FROM wiki.kb_run_request WHERE custom_id = ${customId}`),
      requestMapper, requestOf)[0] ?? null;
  },
  /** findAllById: managed instances; order not guaranteed (callers re-key by id). */
  async findAllById(customIds: readonly string[]): Promise<KbRunRequest[]> {
    if (customIds.length === 0) return [];
    const s = session();
    const out: KbRunRequest[] = [];
    const missing: string[] = [];
    for (const id of customIds) {
      const m = s.find(requestMapper, id);
      if (m) out.push(m);
      else missing.push(id);
    }
    if (missing.length > 0) {
      out.push(...hydrate(await s.query<Row>(sql`SELECT ${REQUEST_COLUMNS} FROM wiki.kb_run_request
        WHERE custom_id = ${anyOf(missing)}`), requestMapper, requestOf));
    }
    return out;
  },
  async saveAll(list: KbRunRequest[]): Promise<void> {
    const s = session();
    for (const r of list) {
      if (r.createdAt == null) r.createdAt = jvmNow();
      await s.persist(requestMapper, r);
    }
  },
  async detach(list: KbRunRequest[]): Promise<void> {
    const s = session();
    for (const r of list) await s.detach(requestMapper, r);
  },
  async countByRunId(runId: string): Promise<number> {
    const [r] = await session().query<Row>(sql`SELECT count(*) AS n FROM wiki.kb_run_request WHERE run_id = ${runId}::uuid`);
    return num(r?.n);
  },
  async pendingIdsAndModels(runId: string, stage: string): Promise<[string, string][]> {
    const rows = await session().query<Row>(sql`SELECT custom_id, model FROM wiki.kb_run_request
      WHERE run_id = ${runId}::uuid AND stage = ${stage} AND status = 'PENDING' ORDER BY custom_id`);
    return rows.map((r) => [String(r.custom_id), String(r.model)]);
  },
  async findByRunIdAndStageAndSubjectId(runId: string, stage: string, subjectId: string): Promise<KbRunRequest[]> {
    return hydrate(await session().query<Row>(sql`SELECT ${REQUEST_COLUMNS} FROM wiki.kb_run_request
      WHERE run_id = ${runId}::uuid AND stage = ${stage} AND subject_id = ${subjectId}`), requestMapper, requestOf);
  },
  async countByRunIdAndStageAndStatusIn(runId: string, stage: string, statuses: readonly string[]): Promise<number> {
    const [r] = await session().query<Row>(sql`SELECT count(*) AS n FROM wiki.kb_run_request
      WHERE run_id = ${runId}::uuid AND stage = ${stage} AND status = ${anyOf(statuses)}`);
    return num(r?.n);
  },
  async countByRunIdAndStage(runId: string, stage: string): Promise<number> {
    const [r] = await session().query<Row>(sql`SELECT count(*) AS n FROM wiki.kb_run_request
      WHERE run_id = ${runId}::uuid AND stage = ${stage}`);
    return num(r?.n);
  },
  async countByRunIdAndStageAndStatus(runId: string, stage: string, status: string): Promise<number> {
    const [r] = await session().query<Row>(sql`SELECT count(*) AS n FROM wiki.kb_run_request
      WHERE run_id = ${runId}::uuid AND stage = ${stage} AND status = ${status}`);
    return num(r?.n);
  },
  async idsByRunAndStage(runId: string, stage: string): Promise<string[]> {
    return ids(await session().query<Row>(sql`SELECT custom_id FROM wiki.kb_run_request
      WHERE run_id = ${runId}::uuid AND stage = ${stage} ORDER BY custom_id`));
  },
  async idsByRunStageStatus(runId: string, stage: string, statuses: readonly string[]): Promise<string[]> {
    return ids(await session().query<Row>(sql`SELECT custom_id FROM wiki.kb_run_request
      WHERE run_id = ${runId}::uuid AND stage = ${stage} AND status = ${anyOf(statuses)} ORDER BY custom_id`));
  },
  async submittedIdsOfJob(jobId: string): Promise<string[]> {
    return ids(await session().query<Row>(sql`SELECT custom_id FROM wiki.kb_run_request
      WHERE batch_job_id = ${jobId}::uuid AND status = 'SUBMITTED' ORDER BY custom_id`));
  },
  async unansweredIdsOfJob(jobId: string): Promise<string[]> {
    return ids(await session().query<Row>(sql`SELECT custom_id FROM wiki.kb_run_request
      WHERE batch_job_id = ${jobId}::uuid AND status = 'SUBMITTED' AND completed_at IS NULL ORDER BY custom_id`));
  },
  async countUnansweredOfJob(jobId: string): Promise<number> {
    const [r] = await session().query<Row>(sql`SELECT count(*) AS n FROM wiki.kb_run_request
      WHERE batch_job_id = ${jobId}::uuid AND status = 'SUBMITTED' AND completed_at IS NULL`);
    return num(r?.n);
  },
  markSubmitted(jobId: string, customIds: readonly string[]): Promise<number> {
    if (customIds.length === 0) return Promise.resolve(0);
    return session().update(sql`UPDATE wiki.kb_run_request SET status = 'SUBMITTED', batch_job_id = ${jobId}::uuid,
      completed_at = NULL, latency_ms = NULL WHERE custom_id = ${anyOf(customIds)}`);
  },
  failSubmittedOfJob(jobId: string, error: string): Promise<number> {
    return session().update(sql`UPDATE wiki.kb_run_request SET status = 'FAILED', error = ${error}
      WHERE batch_job_id = ${jobId}::uuid AND status = 'SUBMITTED'`);
  },
  /** [model, sum(est_tokens), sum(max_tokens)] of a stage's PENDING requests. */
  async pendingEstimate(runId: string, stage: string): Promise<[string, number, number][]> {
    const rows = await session().query<Row>(sql`SELECT model, COALESCE(SUM(est_tokens), 0) AS est,
      COALESCE(SUM(COALESCE(CAST(params ->> 'max_tokens' AS bigint), 4096)), 0) AS max
      FROM wiki.kb_run_request WHERE run_id = ${runId}::uuid AND stage = ${stage} AND status = 'PENDING' GROUP BY model`);
    return rows.map((r) => [String(r.model), num(r.est), num(r.max)]);
  },
  async estimateOf(customIds: readonly string[]): Promise<[string, number, number][]> {
    const rows = await session().query<Row>(sql`SELECT model, COALESCE(SUM(est_tokens), 0) AS est,
      COALESCE(SUM(COALESCE(CAST(params ->> 'max_tokens' AS bigint), 4096)), 0) AS max
      FROM wiki.kb_run_request WHERE custom_id = ${anyOf(customIds)} GROUP BY model`);
    return rows.map((r) => [String(r.model), num(r.est), num(r.max)]);
  },
  async deleteByCustomIds(customIds: readonly string[]): Promise<number> {
    const s = session();
    for (const id of customIds) s.forget(requestMapper, id);
    return s.update(sql`DELETE FROM wiki.kb_run_request WHERE custom_id = ${anyOf(customIds)}`);
  },
  /** Progress rows without payloads. */
  async progressRows(runId: string): Promise<Row[]> {
    return session().query<Row>(sql`SELECT r.stage, r.status, (r.status = 'SUBMITTED' AND r.error IS NOT NULL) AS failed_answer,
      r.est_tokens, r.model, r.created_at,
      COALESCE(r.completed_at, (SELECT min(u.created_at) FROM wiki.kb_llm_usage u WHERE u.request_id = r.custom_id)) AS completed_at,
      r.latency_ms, r.target, r.subject_id
      FROM wiki.kb_run_request r WHERE r.run_id = ${runId}::uuid`);
  },
  /** [model, stage, tokens_out] of answers since `since`, latest first. */
  async recentOutputTokens(since: Odt): Promise<[string, string, number][]> {
    const rows = await session().query<Row>(sql`SELECT model, stage, tokens_out FROM wiki.kb_run_request
      WHERE status = 'DONE' AND tokens_out > 0 AND created_at >= ${pgTime(since)}::timestamptz
      ORDER BY created_at DESC LIMIT 5000`);
    return rows.map((r) => [String(r.model), String(r.stage), num(r.tokens_out)]);
  },
};

// ---- KbBatchJobRepository ---------------------------------------------------------------------------

export const jobs = {
  async findById(id: string): Promise<KbBatchJob | null> {
    const s = session();
    const m = s.find(jobMapper, id);
    if (m) return m;
    return hydrate(await s.query<Row>(sql`SELECT ${JOB_COLUMNS} FROM wiki.kb_batch_job WHERE id = ${id}::uuid`),
      jobMapper, jobOf)[0] ?? null;
  },
  async findByRunIdOrderByCreatedAtAsc(runId: string): Promise<KbBatchJob[]> {
    return hydrate(await session().query<Row>(sql`SELECT ${JOB_COLUMNS} FROM wiki.kb_batch_job
      WHERE run_id = ${runId}::uuid ORDER BY created_at ASC`), jobMapper, jobOf);
  },
  async findByRunIdAndStage(runId: string, stage: string): Promise<KbBatchJob[]> {
    return hydrate(await session().query<Row>(sql`SELECT ${JOB_COLUMNS} FROM wiki.kb_batch_job
      WHERE run_id = ${runId}::uuid AND stage = ${stage}`), jobMapper, jobOf);
  },
  /** save/saveAndFlush of a new job: id assigned, INSERT now (DuplicateKeyError on kb_batch_job_once_idx). */
  async save(job: KbBatchJob): Promise<KbBatchJob> {
    const s = session();
    if (job.id != null && s.find(jobMapper, job.id)) return job;
    if (job.id == null) job.id = crypto.randomUUID();
    if (job.createdAt == null) job.createdAt = jvmNow();
    return s.persist(jobMapper, job);
  },
  async runsWithOpenBatches(now: Odt): Promise<string[]> {
    return ids(await session().query<Row>(sql`SELECT DISTINCT run_id FROM wiki.kb_batch_job WHERE mode = 'BATCH'
      AND (status = 'SUBMITTED' OR (status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= ${pgTime(now)}::timestamptz)))`), 'run_id');
  },
  async expiredObjects(before: Odt, limit: number): Promise<[string, string | null, string | null][]> {
    const rows = await session().query<Row>(sql`SELECT j.id, j.payload_key, j.output_key FROM wiki.kb_batch_job j
      JOIN wiki.kb_run r ON r.id = j.run_id
      WHERE j.created_at < ${pgTime(before)}::timestamptz AND (j.payload_key IS NOT NULL OR j.output_key IS NOT NULL)
        AND j.status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'DRY')
        AND r.status NOT IN ('RUNNING', 'WAITING', 'BLOCKED_BY_COST_LIMIT')
      ORDER BY j.created_at LIMIT ${limit}`);
    return rows.map((r) => [String(r.id), str(r.payload_key), str(r.output_key)]);
  },
  clearObjectKeys(jobIds: readonly string[]): Promise<number> {
    return session().update(sql`UPDATE wiki.kb_batch_job SET payload_key = NULL, output_key = NULL
      WHERE id = ${anyOf(jobIds, 'uuid')}`);
  },
};

// ---- KbFileDigestRepository / KbSubjectStateRepository -------------------------------------------------

export const digests = {
  async findByContentFingerprintInAndPromptVersion(fps: Iterable<string>, promptVersion: string): Promise<KbFileDigest[]> {
    const list = [...fps];
    if (list.length === 0) return [];
    return hydrate(await session().query<Row>(sql`SELECT ${DIGEST_COLUMNS} FROM wiki.kb_file_digest
      WHERE content_fingerprint = ${anyOf(list)} AND prompt_version = ${promptVersion}`), digestMapper, digestOf);
  },
  async save(d: KbFileDigest): Promise<KbFileDigest> {
    const s = session();
    if (s.find(digestMapper, d.id)) {
      await s.flush();
      return d;
    }
    return s.persist(digestMapper, d);
  },
  detach(d: KbFileDigest): Promise<void> {
    return session().detach(digestMapper, d);
  },
};

export const states = {
  async findAll(): Promise<KbSubjectState[]> {
    return hydrate(await session().query<Row>(sql`SELECT subject_id, inputs_hash, inputs::text AS inputs, compiled_at, last_run_id
      FROM wiki.kb_subject_state`), stateMapper, stateOf);
  },
  async findById(subjectId: string): Promise<KbSubjectState | null> {
    const s = session();
    const m = s.find(stateMapper, subjectId);
    if (m) return m;
    return hydrate(await s.query<Row>(sql`SELECT subject_id, inputs_hash, inputs::text AS inputs, compiled_at, last_run_id
      FROM wiki.kb_subject_state WHERE subject_id = ${subjectId}`), stateMapper, stateOf)[0] ?? null;
  },
  async save(st: KbSubjectState): Promise<void> {
    const s = session();
    if (st.isNew) {
      st.isNew = false;
      await s.persist(stateMapper, st);
    } else {
      s.manage(stateMapper, st);
      await s.flush();
    }
  },
};

// ---- KbPageRepository / KbRelationRepository / subjects ---------------------------------------------------

export const pages = {
  async findBySubjectIdAndStatusIn(subjectId: string, statuses: readonly string[]): Promise<KbPageView[]> {
    return hydrate(await session().query<Row>(sql`SELECT ${PAGE_COLUMNS} FROM wiki.kb_page
      WHERE subject_id = ${subjectId} AND status = ${anyOf(statuses)}`), pageMapper, pageOf);
  },
  async findBySubjectId(subjectId: string): Promise<KbPageView[]> {
    return hydrate(await session().query<Row>(sql`SELECT ${PAGE_COLUMNS} FROM wiki.kb_page WHERE subject_id = ${subjectId}`),
      pageMapper, pageOf);
  },
  async findBySubjectIdAndSlug(subjectId: string, slug: string): Promise<KbPageView | null> {
    return hydrate(await session().query<Row>(sql`SELECT ${PAGE_COLUMNS} FROM wiki.kb_page
      WHERE subject_id = ${subjectId} AND slug = ${slug}`), pageMapper, pageOf)[0] ?? null;
  },
  /** [subjectId, sources] of every page with one of `statuses`. */
  async findSubjectSources(statuses: readonly string[]): Promise<[string, string[]][]> {
    const rows = await session().query<Row>(sql`SELECT subject_id, sources::text[] AS sources FROM wiki.kb_page
      WHERE status = ${anyOf(statuses)}`);
    return rows.map((r) => [String(r.subject_id), Array.isArray(r.sources) ? r.sources.map(String) : parseArray(r.sources)]);
  },
  async findSubjectIdsWithStatusNot(status: string): Promise<string[]> {
    return ids(await session().query<Row>(sql`SELECT DISTINCT subject_id FROM wiki.kb_page WHERE status <> ${status}`), 'subject_id');
  },
};

function parseArray(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  const t = v.replace(/^\{|\}$/g, '');
  return t === '' ? [] : t.split(',').map((x) => x.replace(/^"|"$/g, ''));
}

export const relations = {
  /** [relatedId, reason, weight], heaviest first. */
  async findBySubject(subjectId: string): Promise<{ relatedId: string; reason: string; weight: number }[]> {
    const rows = await session().query<Row>(sql`SELECT related_id, reason, weight FROM wiki.kb_subject_relation
      WHERE subject_id = ${subjectId} ORDER BY weight DESC, related_id`);
    return rows.map((r) => ({ relatedId: String(r.related_id), reason: String(r.reason), weight: num(r.weight) }));
  },
};

export const subjects = {
  async names(ids: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    for (const r of await session().query<Row>(sql`SELECT id, name FROM public.subject WHERE id = ${anyOf(ids)}`)) {
      out.set(String(r.id), String(r.name));
    }
    return out;
  },
  async name(id: string): Promise<string | null> {
    const [r] = await session().query<Row>(sql`SELECT name FROM public.subject WHERE id = ${id}`);
    return r ? String(r.name) : null;
  },
};

// ---- DriveFileRepository (pipeline projections) ------------------------------------------------------------

export interface InputRow {
  id: string;
  subjectId: string;
  fingerprint: string | null;
  academicYear: number | null;
  name: string;
  chars: number;
}

export const files = {
  /** Published, non-folder files with a subject and at least `minChars` of text. */
  async pipelineInputs(minChars: number): Promise<InputRow[]> {
    const rows = await session().query<Row>(sql`SELECT f.id, f.effective_subject_id, f.content_fingerprint, f.academic_year,
      f.name, length(f.text_content) AS chars FROM wiki.drive_file f
      WHERE f.publication = 'PUBLISHED' AND f.kind <> 'FOLDER' AND f.effective_subject_id IS NOT NULL
        AND f.text_content IS NOT NULL AND length(f.text_content) >= ${minChars}`);
    return rows.map((r) => ({
      id: String(r.id), subjectId: String(r.effective_subject_id), fingerprint: str(r.content_fingerprint),
      academicYear: r.academic_year == null ? null : num(r.academic_year), name: String(r.name), chars: num(r.chars),
    }));
  },
  async textLengths(fileIds: readonly string[]): Promise<[string, number][]> {
    if (fileIds.length === 0) return [];
    const rows = await session().query<Row>(sql`SELECT id, coalesce(length(text_content), 0) AS n FROM wiki.drive_file
      WHERE id = ${anyOf(fileIds, 'uuid')}`);
    return rows.map((r) => [String(r.id), num(r.n)]);
  },
  async namesOf(fileIds: readonly string[]): Promise<[string, string][]> {
    if (fileIds.length === 0) return [];
    const rows = await session().query<Row>(sql`SELECT id, name FROM wiki.drive_file WHERE id = ${anyOf(fileIds, 'uuid')}`);
    return rows.map((r) => [String(r.id), String(r.name)]);
  },
  /** [id, name, fingerprint, text]. */
  async textsOf(fileIds: readonly string[]): Promise<[string, string, string | null, string | null][]> {
    if (fileIds.length === 0) return [];
    const rows = await session().query<Row>(sql`SELECT id, name, content_fingerprint, text_content FROM wiki.drive_file
      WHERE id = ${anyOf(fileIds, 'uuid')}`);
    return rows.map((r) => [String(r.id), String(r.name), str(r.content_fingerprint), str(r.text_content)]);
  },
  async findCommunityFileIds(fileIds: readonly string[]): Promise<string[]> {
    if (fileIds.length === 0) return [];
    return ids(await session().query<Row>(sql`SELECT f.id FROM wiki.drive_file f, wiki.drive_source s
      WHERE s.id = f.source_id AND s.kind <> 'STUDENT' AND f.id = ${anyOf(fileIds, 'uuid')}`), 'id');
  },
  async names(fileIds: readonly string[]): Promise<Map<string, string>> {
    return new Map(await files.namesOf(fileIds));
  },
  async existsById(id: string): Promise<boolean> {
    return (await session().query<Row>(sql`SELECT 1 FROM wiki.drive_file WHERE id = ${id}::uuid`)).length > 0;
  },
  async fingerprintOf(id: string): Promise<{ id: string; fingerprint: string | null } | null> {
    const [r] = await session().query<Row>(sql`SELECT id, content_fingerprint FROM wiki.drive_file WHERE id = ${id}::uuid`);
    return r ? { id: String(r.id), fingerprint: str(r.content_fingerprint) } : null;
  },
  async countPublishedModifiedSince(since: Odt): Promise<number> {
    const [r] = await session().query<Row>(sql`SELECT count(*) AS n FROM wiki.drive_file f
      WHERE f.publication = 'PUBLISHED' AND f.kind <> 'FOLDER' AND f.effective_subject_id IS NOT NULL
        AND f.text_content IS NOT NULL AND f.drive_modified_at >= ${pgTime(since)}::timestamptz`);
    return num(r?.n);
  },
};

// ---- KbLlmUsageRepository / settings ------------------------------------------------------------------------

export interface UsageRow {
  createdAt: Odt;
  runId: string | null;
  evalId: string | null;
  model: string;
  mode: string;
  stage: string;
  subjectId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: Dec;
  simulated: boolean;
}

function usageOf(r: Row): UsageRow {
  return {
    createdAt: odtOf(str(r.created_at))!, runId: str(r.run_id), evalId: str(r.eval_id), model: String(r.model),
    mode: String(r.mode), stage: String(r.stage), subjectId: str(r.subject_id), inputTokens: num(r.input_tokens),
    cachedInputTokens: num(r.cached_input_tokens), outputTokens: num(r.output_tokens),
    costUsd: decOf(str(r.cost_usd)) ?? Dec.ZERO, simulated: Boolean(r.simulated),
  };
}

const USAGE_COLUMNS = sql.raw(`created_at, run_id, eval_id, model, mode, stage, subject_id, input_tokens,
  cached_input_tokens, output_tokens, cost_usd, simulated`);

export const usage = {
  async sumCostSince(since: Odt): Promise<Dec> {
    const [r] = await session().query<Row>(sql`SELECT coalesce(sum(cost_usd), 0) AS c FROM wiki.kb_llm_usage
      WHERE run_id IS NOT NULL AND created_at >= ${pgTime(since)}::timestamptz`);
    return decOf(str(r?.c)) ?? Dec.ZERO;
  },
  async findByCreatedAtBetween(from: Odt, to: Odt): Promise<UsageRow[]> {
    return (await session().query<Row>(sql`SELECT ${USAGE_COLUMNS} FROM wiki.kb_llm_usage
      WHERE created_at BETWEEN ${pgTime(from)}::timestamptz AND ${pgTime(to)}::timestamptz`)).map(usageOf);
  },
  async findByRunIdIn(runIds: readonly string[]): Promise<UsageRow[]> {
    if (runIds.length === 0) return [];
    return (await session().query<Row>(sql`SELECT ${USAGE_COLUMNS} FROM wiki.kb_llm_usage
      WHERE run_id = ${anyOf(runIds, 'uuid')}`)).map(usageOf);
  },
};

// ---- KbEvalRepository / KbEvalSetRepository (what progress reads) -------------------------

export const evals = {
  /** The eval's set id and its configs (JSON text), or null. */
  async setAndConfigs(evalId: string): Promise<{ setId: string; configs: string | null } | null> {
    const [r] = await session().query<Row>(sql`SELECT set_id, configs::text AS configs FROM wiki.kb_eval WHERE id = ${evalId}::uuid`);
    return r ? { setId: String(r.set_id), configs: str(r.configs) } : null;
  },
  /** The set's subject ids and frozen inputs (JSON texts), or null. */
  async subjectsAndFrozenInputs(setId: string): Promise<{ subjectIds: string | null; frozenInputs: string | null } | null> {
    const [r] = await session().query<Row>(sql`SELECT subject_ids::text AS subject_ids, frozen_inputs::text AS frozen_inputs
      FROM wiki.kb_eval_set WHERE id = ${setId}::uuid`);
    return r ? { subjectIds: str(r.subject_ids), frozenInputs: str(r.frozen_inputs) } : null;
  },
};

export const settingsRow = {
  /** The stored settings object (kb_pipeline_settings id 1), {} without a row. */
  async stored(): Promise<Record<string, unknown>> {
    const [r] = await session().query<Row>(sql`SELECT settings::text AS settings FROM wiki.kb_pipeline_settings WHERE id = 1`);
    const v = r ? jsonOf(String(r.settings)) : null;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  },
};
