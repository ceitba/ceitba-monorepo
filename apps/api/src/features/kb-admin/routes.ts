// web/kb/admin/StaffKbAdminController, StaffKbEndpointController, StaffKbPipelineController,
// StaffKbEvalController and web/kb/StaffKbController (all STAFF: policy.ts METHOD_RULES).
// `@RequestBody JsonNode` bodies are bound with jv.json() (Spring's 415/400 handling) and
// re-read from the raw text with Jackson's number rules (values.ts readJacksonTree).
// Parameters of the four web.kb.admin controllers use ./params (KbAdminExceptionHandler).

import { defineRoutes, noContent } from '../../http/router';
import { ValidationError } from '../../http/errors';
import { jv, param, parseJavaUuid } from '../../http/validation';
import { asText, elements, nodeToString, path, JDouble, type Node } from '../kb/logic/jsonNode';
import { jIsBlank, lowerRoot } from '../kb/logic/javaString';
import { from as fromParam, to as toParam } from '../kb/logic/web/kbDateParam';
import { kbPipeline } from '../kb-pipeline/service';
import { kbReader } from '../kb-reader/services';
import { KbImportRequest } from '../kb-reader/dto';
import { ap } from './params';
import { kbAdmin } from './service';
import { jackson, readJacksonTree } from './values';

const STAGES = ['digest', 'plan', 'write', 'retry'];
const ADMIN = ['Subject wikis - admin'];
const json = { body: jv.json(), bodyValidation: 'bindOnly' as const };

/** The @RequestBody JsonNode: the raw body re-read with Jackson's number rules. */
const tree = (raw: string | null): Node => (raw == null || raw.length === 0 ? null : readJacksonTree(raw));

/** StaffKbEvalController.setId: UUID.fromString(body.path("setId").asText("")), else 400 naming the node. */
function setIdOf(body: Node): string {
  const n = path(body, 'setId');
  const id = parseJavaUuid(asText(n, '')!);
  if (id == null) throw new ValidationError('setId', n === undefined ? '' : nodeToString(n), 'required UUID');
  return id;
}

export default defineRoutes((r, deps) => {
  const admin = kbAdmin(deps);
  // KbCostService / KbQuotaService / KbPipelineService are kb-pipeline's (API.md).
  const costService = () => kbPipeline(deps).costs;
  const quotaService = () => kbPipeline(deps).quota;
  const pipeline = () => kbPipeline(deps).pipeline;

  // ---- StaffKbAdminController: quota, settings, models, costs ----

  r.get('/v1/staff/kb/quota', { tags: ADMIN, summary: 'DigitalOcean rate-limit counters last seen in response headers', query: { refresh: ap.bool(false) } },
    ({ query }) => jackson(quotaService().get(query.refresh!)));

  r.get('/v1/staff/kb/settings', { tags: ADMIN, summary: 'Effective runtime settings (stored overrides on top of the environment)' },
    async () => jackson(await admin.settings.get()));
  r.put('/v1/staff/kb/settings', { tags: ADMIN, summary: 'Change settings (validated, versioned); returns costImpact', currentUser: true, ...json },
    async ({ user, rawBody }) => jackson(await admin.settings.update(user!.id, tree(rawBody))));
  r.post('/v1/staff/kb/settings/preview', { tags: ADMIN, summary: 'Validation errors and cost impact of proposed settings, nothing saved', ...json },
    async ({ rawBody }) => jackson(await admin.settings.preview(tree(rawBody))));
  r.get('/v1/staff/kb/settings/history', { tags: ADMIN, summary: 'Previous settings versions, newest first', query: { limit: ap.int(50) } },
    async ({ query }) => jackson(await admin.settings.history(query.limit!)));
  r.post('/v1/staff/kb/settings/history/{id}/restore', { tags: ADMIN, summary: 'Restore a previous settings version (recorded as a new version)', params: { id: ap.uuid() }, currentUser: true },
    async ({ params, user }) => jackson(await admin.settings.restore(user!.id, params.id!)));

  r.get('/v1/staff/kb/models', { tags: ADMIN, summary: 'Model catalog with effective prices, batch support and last probe' },
    async () => jackson(await admin.catalog.list()));
  r.post('/v1/staff/kb/models', { tags: ADMIN, summary: 'Add a model to the catalog', ...json },
    async ({ rawBody }) => jackson(await admin.catalog.create(tree(rawBody))));
  r.put('/v1/staff/kb/models/{id}', { tags: ADMIN, summary: 'Edit a model (prices, batchDiscount, enabled, ...)', params: { id: ap.string() }, ...json },
    async ({ params, rawBody }) => jackson(await admin.catalog.update(params.id!, tree(rawBody))));
  r.post('/v1/staff/kb/models/sync', { tags: ADMIN, summary: "Compare the catalog with the provider's /v1/models" },
    async () => jackson(await admin.catalog.sync()));
  r.post('/v1/staff/kb/models/{id}/probe', { tags: ADMIN, summary: 'Probe a model (one tiny structured request); mode=batch|sync overrides the routed mode', params: { id: ap.string() }, query: { mode: ap.string({ required: false }) } },
    async ({ params, query }) => jackson(await admin.catalog.probe(params.id!, query.mode ?? null)));
  r.get('/v1/staff/kb/models/{id}/stage-cost', { tags: ADMIN, summary: 'Expected weekly cost with this model in a stage, other settings unchanged', params: { id: ap.string() }, query: { stage: ap.string() } },
    async ({ params, query }) => {
      const stage = query.stage!;
      const key = lowerRoot(stage);
      if (!STAGES.includes(key)) throw new ValidationError('stage', stage, 'must be digest, plan, write or retry');
      const body = { ['model' + key.charAt(0).toUpperCase() + key.substring(1)]: params.id! };
      return jackson(await admin.forecast.stageCost(await admin.settings.proposed(body), params.id!, key));
    });

  r.get('/v1/staff/kb/costs', {
    tags: ADMIN, summary: 'Recorded LLM usage grouped by week, model, stage, subject (or week,stage / week,model)',
    query: { from: ap.string({ required: false }), to: ap.string({ required: false }), groupBy: ap.string({ def: 'week' }), reprice: ap.bool(false) },
  }, async ({ query }) => {
    const f = fromParam(query.from ?? null);
    const t = toParam(query.to ?? null);
    if (f != null && t != null && f.isAfter(t)) throw new ValidationError('from', query.from, 'must not be after to');
    return jackson(await costService().costs(f, t, query.groupBy!, query.reprice!));
  });
  r.get('/v1/staff/kb/costs/summary', { tags: ADMIN, summary: 'Last 7 / 30 days, projection, by stage and model, top subjects, forecast accuracy' },
    async () => jackson(await costService().summary()));
  r.get('/v1/staff/kb/costs/forecast', { tags: ADMIN, summary: 'Expected cost of the next run, a week, a month and a full rebuild (settings= proposed JSON)', query: { settings: ap.string({ required: false }) } },
    async ({ query }) => {
      const proposed = query.settings ?? null;
      if (proposed == null || jIsBlank(proposed)) return jackson(await admin.forecast.forecast(await admin.settings.effective()));
      let body: Node;
      try {
        body = readJacksonTree(proposed);
      } catch {
        throw new ValidationError('settings', proposed, 'not valid JSON');
      }
      return jackson(await admin.forecast.forecast(await admin.settings.proposed(body)));
    });
  r.post('/v1/staff/kb/costs/forecast', { tags: ADMIN, summary: 'Forecast for proposed settings (body: a settings object)', ...json, bodyOptional: true },
    async ({ rawBody }) => {
      const body = tree(rawBody);
      return jackson(await admin.forecast.forecast(body == null ? await admin.settings.effective() : await admin.settings.proposed(body)));
    });

  // ---- StaffKbEndpointController ----

  r.get('/v1/staff/kb/endpoints', { tags: ADMIN, summary: 'Custom endpoints (the API key is never returned: hasKey / keyReadable)' },
    async () => jackson(await admin.endpoints.list()));
  r.post('/v1/staff/kb/endpoints', { tags: ADMIN, summary: 'Add an endpoint {name, baseUrl, apiKey?, maxConcurrency?, timeoutSec?, enabled?}', currentUser: true, ...json },
    async ({ user, rawBody }) => jackson(await admin.endpoints.create(user!.id, tree(rawBody))));
  r.put('/v1/staff/kb/endpoints/{id}', { tags: ADMIN, summary: 'Edit an endpoint; apiKey omitted keeps the key, "" removes it', params: { id: ap.uuid() }, currentUser: true, ...json },
    async ({ params, user, rawBody }) => jackson(await admin.endpoints.update(user!.id, params.id!, tree(rawBody))));
  r.delete('/v1/staff/kb/endpoints/{id}', { tags: ADMIN, summary: 'Delete an endpoint and its catalog models; 409 KB_ENDPOINT_IN_USE while settings or an active run use one', params: { id: ap.uuid() }, status: 204 },
    async ({ params }) => { await admin.endpoints.delete(params.id!); });
  r.post('/v1/staff/kb/endpoints/{id}/test', { tags: ADMIN, summary: 'GET {baseUrl}/models with latency', params: { id: ap.uuid() } },
    async ({ params }) => jackson(await admin.endpoints.test(params.id!)));
  r.post('/v1/staff/kb/endpoints/{id}/discover', { tags: ADMIN, summary: "Add the endpoint's models to the catalog as custom:<name>:<slug> (disabled, price 0)", params: { id: ap.uuid() } },
    async ({ params }) => jackson(await admin.endpoints.discover(params.id!)));
  r.get('/v1/staff/kb/endpoints/{id}/stats', { tags: ADMIN, summary: 'Requests, errors, p50/p95 latency, output tok/s and in-flight calls in the last N minutes', params: { id: ap.uuid() }, query: { minutes: ap.int(60) } },
    async ({ params, query }) => {
      const s = await admin.endpoints.stats(params.id!, query.minutes!);
      return { ...s, outputTokensPerSec: new JDouble(s.outputTokensPerSec) };
    });

  // ---- StaffKbPipelineController (the parts that are the catalog's / evals') ----

  const PIPELINE = ['Subject wikis - pipeline'];
  r.post('/v1/staff/kb/pipeline/runs', { tags: PIPELINE, summary: 'Start a manual run (dryRun stops after PLAN and publishes nothing); 409 while one is active', query: { dryRun: ap.bool(false) }, status: 202 },
    async ({ query }) => jackson(await pipeline().trigger('MANUAL', query.dryRun!)));
  r.get('/v1/staff/kb/pipeline/runs', { tags: PIPELINE, summary: 'Recent pipeline runs, newest first', query: { limit: ap.int(20) } },
    async ({ query }) => jackson(await pipeline().runs(query.limit!)));
  r.get('/v1/staff/kb/pipeline/runs/{id}', { tags: PIPELINE, summary: 'A run with its subjects, batches and costs', params: { id: ap.uuid() } },
    async ({ params }) => jackson(await pipeline().run(params.id!)));
  r.get('/v1/staff/kb/pipeline/runs/{id}/progress', { tags: PIPELINE, summary: 'Just the progress of a run (cheap; for polling every few seconds)', params: { id: ap.uuid() } },
    async ({ params }) => jackson(await pipeline().progress(params.id!)));
  r.post('/v1/staff/kb/pipeline/runs/{id}/cancel', { tags: PIPELINE, summary: 'Cancel an active run (cancels its open batches)', params: { id: ap.uuid() } },
    async ({ params }) => jackson(await pipeline().cancel(params.id!)));
  r.post('/v1/staff/kb/pipeline/runs/{id}/approve-cost', { tags: PIPELINE, summary: 'Let a run blocked by the weekly cost limit continue', params: { id: ap.uuid() } },
    async ({ params }) => jackson(await pipeline().approveCost(params.id!)));
  r.post('/v1/staff/kb/pipeline/baseline', { tags: PIPELINE, summary: 'Record the current inputs as already processed (no LLM requests)' },
    async () => jackson(await pipeline().baseline()));
  r.get('/v1/staff/kb/pipeline/preview', { tags: PIPELINE, summary: 'What the next run would do (changed subjects and files), without requests' },
    async () => jackson(await pipeline().preview()));
  r.post('/v1/staff/kb/pipeline/compare', { tags: PIPELINE, summary: 'Alias: an eval of one subject {subjectId, models:[{plan, write, reasoningEffort?}]}', currentUser: true, ...json, status: 202 },
    async ({ user, rawBody }) => {
      const body = tree(rawBody);
      return jackson(await admin.evals.compare(asText(path(body, 'subjectId'), null), path(body, 'models'), user!.id));
    });
  r.post('/v1/staff/kb/pipeline/probe', { tags: PIPELINE, summary: 'Probe a model {model, mode?}: one tiny structured request; result stored in the catalog', ...json },
    async ({ rawBody }) => {
      const body = tree(rawBody);
      const model = body == null ? null : asText(path(body, 'model'), null);
      if (model == null || jIsBlank(model)) throw new ValidationError('model', model, 'required');
      return jackson(await admin.catalog.probe(model, asText(path(body, 'mode'), null)));
    });

  // ---- StaffKbEvalController ----

  const EVALS = ['Subject wikis - evals'];
  r.get('/v1/staff/kb/evals/sets', { tags: EVALS, summary: 'Benchmark sets ("Básico" is created on first use)' },
    async () => jackson(await admin.evals.sets()));
  r.post('/v1/staff/kb/evals/sets', { tags: EVALS, summary: 'Create a set {name, subjectIds}; its inputs are frozen now', currentUser: true, ...json, status: 201 },
    async ({ user, rawBody }) => {
      const body = tree(rawBody);
      const ids = elements(path(body, 'subjectIds')).map((n) => asText(n));
      return jackson(await admin.evals.createSet(asText(path(body, 'name'), null), ids, user!.id));
    });
  r.post('/v1/staff/kb/evals/sets/{id}/refreeze', { tags: EVALS, summary: "Freeze the set's current inputs again (later evals use the new snapshot)", params: { id: ap.uuid() } },
    async ({ params }) => jackson(await admin.evals.refreeze(params.id!)));
  r.post('/v1/staff/kb/evals/estimate', { tags: EVALS, summary: 'Estimated tokens and cost of an eval {setId, models}', ...json },
    async ({ rawBody }) => {
      const body = tree(rawBody);
      return jackson(await admin.evals.estimate(setIdOf(body), path(body, 'models')));
    });
  r.post('/v1/staff/kb/evals', { tags: EVALS, summary: 'Start an eval {setId, models:[{plan, write, reasoningEffort?}], note?}; 409 KB_EVAL_ACTIVE', currentUser: true, ...json, status: 202 },
    async ({ user, rawBody }) => {
      const body = tree(rawBody);
      return jackson(await admin.evals.create(setIdOf(body), path(body, 'models'), asText(path(body, 'note'), null), user!.id));
    });
  r.get('/v1/staff/kb/evals', { tags: EVALS, summary: 'Evals, newest first', query: { setId: ap.uuid({ required: false }), limit: ap.int(20) } },
    async ({ query }) => jackson(await admin.evals.list(query.setId ?? null, query.limit!)));
  r.get('/v1/staff/kb/evals/leaderboard', { tags: EVALS, summary: 'Configurations of a set (default Básico) ranked by blind win rate, with metrics and cost', query: { setId: ap.uuid({ required: false }) } },
    async ({ query }) => jackson(await admin.evals.leaderboard(query.setId ?? null)));
  r.get('/v1/staff/kb/evals/{id}', { tags: EVALS, summary: 'An eval with per-configuration metrics and per-subject pages', currentUser: true, params: { id: ap.uuid() }, argOrder: ['user', 'params'] },
    async ({ user, params }) => jackson(await admin.evals.get(params.id!, user!.id)));
  r.get('/v1/staff/kb/evals/{id}/progress', { tags: EVALS, summary: 'Just the progress of an eval (cheap; for polling every few seconds)', params: { id: ap.uuid() } },
    async ({ params }) => jackson(await admin.evals.progress(params.id!)));
  r.get('/v1/staff/kb/evals/{id}/review/progress', { tags: EVALS, summary: 'Blind review progress: pairs reviewed by the caller and by anyone, ratings per configuration', currentUser: true, params: { id: ap.uuid() }, argOrder: ['user', 'params'] },
    async ({ user, params }) => jackson(await admin.evals.reviewProgress(params.id!, user!.id)));
  r.post('/v1/staff/kb/evals/{id}/cancel', { tags: EVALS, summary: 'Cancel a running eval', params: { id: ap.uuid() } },
    async ({ params }) => jackson(await admin.evals.cancel(params.id!)));
  r.get('/v1/staff/kb/evals/{id}/pages', { tags: EVALS, summary: 'A page an eval configuration wrote', params: { id: ap.uuid() }, query: { configKey: ap.string(), subjectId: ap.string(), slug: ap.string() } },
    async ({ params, query }) => jackson(await admin.evals.page(params.id!, query.configKey!, query.subjectId!, query.slug!)));
  r.get('/v1/staff/kb/evals/{id}/review/next', { tags: EVALS, summary: 'The next blind A/B pair for this reviewer; 204 when none is left', currentUser: true, params: { id: ap.uuid() }, query: { subjectId: ap.string({ required: false }), slug: ap.string({ required: false }) }, argOrder: ['user', 'params', 'query'] },
    async ({ user, params, query }) => {
      const pair = await admin.evals.next(params.id!, user!.id, query.subjectId ?? null, query.slug ?? null);
      return pair == null ? noContent() : jackson(pair);
    });
  r.post('/v1/staff/kb/evals/{id}/review', { tags: EVALS, summary: 'Rate the pending pair {subjectId, slug, winner: A|B|tie, scoresA, scoresB, comment}', currentUser: true, params: { id: ap.uuid() }, ...json, argOrder: ['user', 'params', 'body'] },
    async ({ user, params, rawBody }) => jackson(await admin.evals.review(params.id!, user!.id, tree(rawBody))));
  r.post('/v1/staff/kb/evals/{id}/promote', { tags: EVALS, summary: "Copy a configuration's models into the settings {configKey}", currentUser: true, params: { id: ap.uuid() }, ...json, argOrder: ['user', 'params', 'body'] },
    async ({ user, params, rawBody }) => jackson(await admin.evals.promote(params.id!, asText(path(tree(rawBody), 'configKey'), null), user!.id)));

  // ---- StaffKbController (web.kb: Spring's own parameter errors; kb-reader's services) ----

  const STAFF_KB = ['Subject wikis - staff'];
  r.post('/v1/staff/kb/subjects/{subjectId}/import', { tags: STAFF_KB, summary: "Import a subject's wiki pages (one transaction; rejected pages keep their last revision)", params: { subjectId: param.string() }, body: KbImportRequest },
    async ({ params, body }) => jackson(await kbReader(deps).importer.importSubject(params.subjectId!, { pages: (body.pages ?? []) as never[], replace: body.replace as boolean })));
  r.post('/v1/staff/kb/pages/{pageId}/hide', { tags: STAFF_KB, summary: 'Hide a page from readers', currentUser: true, params: { pageId: param.uuid() }, argOrder: ['user', 'params'] },
    async ({ user, params }) => jackson(await kbReader(deps).moderation.hide(user!.id, params.pageId!)));
  r.post('/v1/staff/kb/pages/{pageId}/restore', { tags: STAFF_KB, summary: 'Publish a page again and dismiss its reports', currentUser: true, params: { pageId: param.uuid() }, argOrder: ['user', 'params'] },
    async ({ user, params }) => jackson(await kbReader(deps).moderation.restore(user!.id, params.pageId!)));
  r.get('/v1/staff/kb/pages', { tags: STAFF_KB, summary: 'Pages by status (default HIDDEN), most recently changed first', query: { status: param.string({ required: false }), page: param.int({ def: 0, primitive: true }), limit: param.int({ def: 20, primitive: true }) } },
    async ({ query }) => jackson(await kbReader(deps).moderation.list(query.status ?? null, query.page!, query.limit!)));
});
