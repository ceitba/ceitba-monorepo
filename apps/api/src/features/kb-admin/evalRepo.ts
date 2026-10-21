// repository/kb/KbEvalSetRepository, KbEvalRepository, KbEvalRatingRepository and the
// small projections KbEvalService reads (subjects, drive file texts, usage of an eval).

import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { Dec } from '../kb/logic/decimal';
import type { JsonValue } from '../kb/logic/jsonNode';
import type { Odt } from '../kb/logic/odt';
import { arrayLiteral, rows } from './repo';
import { jsonOf, odtOf, pgJson, pgTime } from './values';

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v == null ? null : String(v));
const n = (v: unknown): number | null => (v == null ? null : Number(v));

// ---- sets -----------------------------------------------------------------------

export interface EvalSetRow {
  id: string;
  name: string;
  subjectIds: JsonValue;
  createdBy: string | null;
  createdAt: Odt;
  frozenInputs: JsonValue | null;
  frozenAt: Odt | null;
}

const SET_COLUMNS = sql.raw(`id::text AS id, name, subject_ids::text AS subject_ids, created_by::text AS created_by,
  created_at::text AS created_at, frozen_inputs::text AS frozen_inputs, frozen_at::text AS frozen_at`);

const setOf = (r: Row): EvalSetRow => ({
  id: String(r.id), name: String(r.name), subjectIds: jsonOf(s(r.subject_ids))!, createdBy: s(r.created_by),
  createdAt: odtOf(s(r.created_at))!, frozenInputs: jsonOf(s(r.frozen_inputs)), frozenAt: odtOf(s(r.frozen_at)),
});

export async function setsByCreatedAt(db: Db): Promise<EvalSetRow[]> {
  return (await rows(db, sql`SELECT ${SET_COLUMNS} FROM wiki.kb_eval_set ORDER BY created_at`)).map(setOf);
}

export async function setById(db: Db, id: string): Promise<EvalSetRow | null> {
  const [r] = await rows(db, sql`SELECT ${SET_COLUMNS} FROM wiki.kb_eval_set WHERE id = ${id}::uuid`);
  return r ? setOf(r) : null;
}

export async function setByName(db: Db, name: string): Promise<EvalSetRow | null> {
  const [r] = await rows(db, sql`SELECT ${SET_COLUMNS} FROM wiki.kb_eval_set WHERE name = ${name}`);
  return r ? setOf(r) : null;
}

/** saveAndFlush(new KbEvalSet(name, subjectIds, createdBy)): created_at = @CreationTimestamp (JVM now). */
export async function insertSet(db: Db, id: string, name: string, subjectIds: JsonValue, createdBy: string | null, createdAt: Odt): Promise<void> {
  await db.execute(sql`INSERT INTO wiki.kb_eval_set (id, name, subject_ids, created_by, created_at, frozen_inputs, frozen_at)
                       VALUES (${id}::uuid, ${name}, ${pgJson(subjectIds)}::jsonb, ${createdBy}::uuid, ${pgTime(createdAt)}::timestamptz, NULL, NULL)`);
}

export async function freezeSet(db: Db, id: string, frozen: JsonValue, at: Odt): Promise<void> {
  await db.execute(sql`UPDATE wiki.kb_eval_set SET frozen_inputs = ${pgJson(frozen)}::jsonb, frozen_at = ${pgTime(at)}::timestamptz
                       WHERE id = ${id}::uuid`);
}

// ---- evals ----------------------------------------------------------------------

export interface EvalRow {
  id: string;
  setId: string;
  configs: JsonValue;
  note: string | null;
  results: JsonValue;
  createdBy: string | null;
  createdAt: Odt;
  finishedAt: Odt | null;
}

const EVAL_COLUMNS = sql.raw(`id::text AS id, set_id::text AS set_id, configs::text AS configs, note, results::text AS results,
  created_by::text AS created_by, created_at::text AS created_at, finished_at::text AS finished_at`);

const evalOf = (r: Row): EvalRow => ({
  id: String(r.id), setId: String(r.set_id), configs: jsonOf(s(r.configs))!, note: s(r.note), results: jsonOf(s(r.results))!,
  createdBy: s(r.created_by), createdAt: odtOf(s(r.created_at))!, finishedAt: odtOf(s(r.finished_at)),
});

export async function evalById(db: Db, id: string): Promise<EvalRow | null> {
  const [r] = await rows(db, sql`SELECT ${EVAL_COLUMNS} FROM wiki.kb_eval WHERE id = ${id}::uuid`);
  return r ? evalOf(r) : null;
}

export async function allEvals(db: Db): Promise<EvalRow[]> {
  return (await rows(db, sql`SELECT ${EVAL_COLUMNS} FROM wiki.kb_eval`)).map(evalOf);
}

export async function evalsNewestFirst(db: Db, limit: number): Promise<EvalRow[]> {
  return (await rows(db, sql`SELECT ${EVAL_COLUMNS} FROM wiki.kb_eval ORDER BY created_at DESC LIMIT ${limit}`)).map(evalOf);
}

export async function evalsOfSetOldestFirst(db: Db, setId: string): Promise<EvalRow[]> {
  return (await rows(db, sql`SELECT ${EVAL_COLUMNS} FROM wiki.kb_eval WHERE set_id = ${setId}::uuid ORDER BY created_at`)).map(evalOf);
}

export async function insertEval(db: Db, e: { id: string; setId: string; configs: JsonValue; note: string | null; results: JsonValue; createdBy: string | null; createdAt: Odt }): Promise<void> {
  await db.execute(sql`INSERT INTO wiki.kb_eval (id, set_id, configs, note, results, created_by, created_at, finished_at)
    VALUES (${e.id}::uuid, ${e.setId}::uuid, ${pgJson(e.configs)}::jsonb, ${e.note}, ${pgJson(e.results)}::jsonb, ${e.createdBy}::uuid,
      ${pgTime(e.createdAt)}::timestamptz, NULL)`);
}

export async function updateResults(db: Db, id: string, results: JsonValue): Promise<void> {
  await db.execute(sql`UPDATE wiki.kb_eval SET results = ${pgJson(results)}::jsonb WHERE id = ${id}::uuid`);
}

export async function finishEval(db: Db, id: string, at: Odt): Promise<void> {
  await db.execute(sql`UPDATE wiki.kb_eval SET finished_at = ${pgTime(at)}::timestamptz WHERE id = ${id}::uuid`);
}

// ---- ratings ----------------------------------------------------------------------

export interface RatingRow {
  id: string;
  evalId: string;
  subjectId: string;
  slug: string;
  configA: string;
  configB: string;
  reviewerId: string;
  winner: string | null;
  accuracyA: number | null;
  clarityA: number | null;
  usefulnessA: number | null;
  accuracyB: number | null;
  clarityB: number | null;
  usefulnessB: number | null;
  comment: string | null;
  assignedAt: Odt;
  ratedAt: Odt | null;
}

const RATING_COLUMNS = sql.raw(`id::text AS id, eval_id::text AS eval_id, subject_id, slug, config_a, config_b,
  reviewer_id::text AS reviewer_id, winner, accuracy_a, clarity_a, usefulness_a, accuracy_b, clarity_b, usefulness_b, comment,
  assigned_at::text AS assigned_at, rated_at::text AS rated_at`);

const ratingOf = (r: Row): RatingRow => ({
  id: String(r.id), evalId: String(r.eval_id), subjectId: String(r.subject_id), slug: String(r.slug), configA: String(r.config_a),
  configB: String(r.config_b), reviewerId: String(r.reviewer_id), winner: s(r.winner), accuracyA: n(r.accuracy_a), clarityA: n(r.clarity_a),
  usefulnessA: n(r.usefulness_a), accuracyB: n(r.accuracy_b), clarityB: n(r.clarity_b), usefulnessB: n(r.usefulness_b), comment: s(r.comment),
  assignedAt: odtOf(s(r.assigned_at))!, ratedAt: odtOf(s(r.rated_at)),
});

export async function ratingsOfEval(db: Db, evalId: string): Promise<RatingRow[]> {
  return (await rows(db, sql`SELECT ${RATING_COLUMNS} FROM wiki.kb_eval_rating WHERE eval_id = ${evalId}::uuid`)).map(ratingOf);
}

export async function ratingsOfEvals(db: Db, evalIds: string[]): Promise<RatingRow[]> {
  if (!evalIds.length) return [];
  return (await rows(db, sql`SELECT ${RATING_COLUMNS} FROM wiki.kb_eval_rating WHERE eval_id = ANY(${arrayLiteral(evalIds)}::uuid[])`)).map(ratingOf);
}

/** findByEvalIdAndReviewerIdAndSubjectIdAndSlugOrderByAssignedAtDesc. */
export async function ratingsOfPage(db: Db, evalId: string, reviewerId: string, subjectId: string | null, slug: string | null): Promise<RatingRow[]> {
  return (await rows(db, sql`SELECT ${RATING_COLUMNS} FROM wiki.kb_eval_rating WHERE eval_id = ${evalId}::uuid
      AND reviewer_id = ${reviewerId}::uuid AND subject_id = ${subjectId} AND slug = ${slug} ORDER BY assigned_at DESC`)).map(ratingOf);
}

export async function insertRating(db: Db, r: RatingRow): Promise<void> {
  await db.execute(sql`INSERT INTO wiki.kb_eval_rating (id, eval_id, subject_id, slug, config_a, config_b, reviewer_id, winner,
      accuracy_a, clarity_a, usefulness_a, accuracy_b, clarity_b, usefulness_b, comment, assigned_at, rated_at)
    VALUES (${r.id}::uuid, ${r.evalId}::uuid, ${r.subjectId}, ${r.slug}, ${r.configA}, ${r.configB}, ${r.reviewerId}::uuid, ${r.winner},
      ${r.accuracyA}::smallint, ${r.clarityA}::smallint, ${r.usefulnessA}::smallint, ${r.accuracyB}::smallint, ${r.clarityB}::smallint,
      ${r.usefulnessB}::smallint, ${r.comment}, ${pgTime(r.assignedAt)}::timestamptz, ${pgTime(r.ratedAt)}::timestamptz)`);
}

export async function updateRating(db: Db, r: RatingRow): Promise<void> {
  await db.execute(sql`UPDATE wiki.kb_eval_rating SET winner = ${r.winner}, accuracy_a = ${r.accuracyA}::smallint,
      clarity_a = ${r.clarityA}::smallint, usefulness_a = ${r.usefulnessA}::smallint, accuracy_b = ${r.accuracyB}::smallint,
      clarity_b = ${r.clarityB}::smallint, usefulness_b = ${r.usefulnessB}::smallint, comment = ${r.comment},
      rated_at = ${pgTime(r.ratedAt)}::timestamptz WHERE id = ${r.id}::uuid`);
}

// ---- projections --------------------------------------------------------------------

export async function subjectNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  for (const r of await rows(db, sql`SELECT id, name FROM public.subject WHERE id = ANY(${arrayLiteral(ids)}::text[])`)) {
    out.set(String(r.id), String(r.name));
  }
  return out;
}

export async function subjectExists(db: Db, id: string): Promise<boolean> {
  return (await rows(db, sql`SELECT 1 FROM public.subject WHERE id = ${id}`)).length > 0;
}

export async function fileTexts(db: Db, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!ids.length) return out;
  for (const r of await rows(db, sql`SELECT id::text AS id, text_content FROM wiki.drive_file WHERE id = ANY(${arrayLiteral(ids)}::uuid[])`)) {
    out.set(String(r.id), s(r.text_content));
  }
  return out;
}

export async function fileExists(db: Db, id: string): Promise<boolean> {
  return (await rows(db, sql`SELECT 1 FROM wiki.drive_file WHERE id = ${id}::uuid`)).length > 0;
}

/** findByEvalId: [requestId, costUsd]. */
export async function usageOfEval(db: Db, evalId: string): Promise<{ requestId: string | null; costUsd: Dec }[]> {
  return (await rows(db, sql`SELECT request_id, cost_usd::text AS cost_usd FROM wiki.kb_llm_usage WHERE eval_id = ${evalId}::uuid`))
    .map((r) => ({ requestId: s(r.request_id), costUsd: Dec.parse(String(r.cost_usd)) }));
}
