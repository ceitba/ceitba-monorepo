// The kb-pipeline beans, one set per Deps (constructors do no I/O). See API.md.
//
//   import { kbPipeline } from '../kb-pipeline/service';
//   const kb = kbPipeline(deps);
//   kb.pipeline.trigger/runs/run/progress/cancel/approveCost/baseline/preview   KbPipelineService
//   kb.engine.register(handler)/request/kick/advance/advanceActive/cancel       KbRunEngine
//   kb.router / kb.sync / kb.batch / kb.usage / kb.payloads / kb.endpoints       service/kb/llm
//   kb.costs / kb.quota                                                          KbCostService / KbQuotaService
//   kb.progress / kb.retention / kb.inputs / kb.quotaTracker
//
// Wiring mirrors config/KbPipelineConfig + the Spring beans of service/kb/{pipeline,llm,progress}.

import type { Deps } from '../../deps';
import { DoQuotaTracker } from '../kb/logic/external/doQuotaTracker';
import type { BatchLlmExecutor as BatchExec } from '../kb/logic/llm/batchLlmExecutor';
import { BatchLlmExecutor } from '../kb/logic/llm/batchLlmExecutor';
import { KbEndpointRegistry } from '../kb/logic/llm/kbEndpointRegistry';
import { KbLlmRouter } from '../kb/logic/llm/kbLlmRouter';
import { KbSecretCipher } from '../kb/logic/llm/kbSecretCipher';
import { KbUsageRecorder } from '../kb/logic/llm/kbUsageRecorder';
import { SyncLlmExecutor } from '../kb/logic/llm/syncLlmExecutor';
import { ART_ZONE, odtFromMicros, type Now } from '../kb/logic/odt';
import { KbBatchSubmitter } from '../kb/logic/pipeline/kbBatchSubmitter';
import { KbPayloads } from '../kb/logic/pipeline/kbPayloads';
import { collaborators, type KbForecastPort, type KbSettingsPort } from './collaborators';
import { KbCostService, KbQuotaService } from './costs';
import {
  DbKbBatchJobStore, DbKbLlmEndpointStore, DbKbLlmUsageStore, DbKbModelStore, DbKbRunRequestStore, DbKbRunStore,
} from './db/stores';
import { txRunner } from './db/session';
import { KbRunEngine } from './engine';
import * as inputs from './inputs';
import { KbPipelineService } from './pipeline';
import { KbProgressService } from './progress';
import { KbRunRetentionService } from './retention';
import { DbKbSettings, llmProperties, pipelineProperties } from './settings';

export { provideKbCollaborators } from './collaborators';
export type { KbCollaborators, KbImporterPort, KbForecastPort, KbSettingsPort, KbCatalogPort } from './collaborators';
export { KbPipelineError } from '../kb/logic/pipeline/kbPipelineError';
export { ACTIVE, MOVING, Seq, type KbRunHandler } from './engine';
export type { KbRun, KbRunSubject } from './db/entities';
export { inTx, session } from './db/session';

export interface KbPipeline {
  pipeline: KbPipelineService;
  engine: KbRunEngine;
  router: KbLlmRouter;
  sync: SyncLlmExecutor;
  batch: BatchExec;
  usage: KbUsageRecorder;
  payloads: KbPayloads;
  endpoints: KbEndpointRegistry;
  submitter: KbBatchSubmitter;
  costs: KbCostService;
  quota: KbQuotaService;
  progress: KbProgressService;
  retention: KbRunRetentionService;
  inputs: typeof inputs;
  quotaTracker: DoQuotaTracker;
  models: DbKbModelStore;
  /** The settings in force: the registered KbSettingsService, else this package's fallback. */
  settings(): KbSettingsPort;
  forecast(): KbForecastPort;
}

const instances = new WeakMap<Deps, KbPipeline>();

/** OffsetDateTime.now(clock): the business clock at ART. */
export function nowOf(deps: Deps): Now {
  return () => odtFromMicros(deps.clock.now(), ART_ZONE);
}

export function kbPipeline(deps: Deps): KbPipeline {
  const existing = instances.get(deps);
  if (existing) return existing;
  const { db, config } = deps;
  const log = deps.log.child({ component: 'KbPipeline' });
  const now = nowOf(deps);
  const llmProps = llmProperties(config);
  const quotaTracker = deps.llm.quota ?? new DoQuotaTracker(now);
  const models = new DbKbModelStore(db);
  const cipher = new KbSecretCipher(config.kb.secretsKey, config.auth.jwt.secret);
  const endpoints = new KbEndpointRegistry(new DbKbLlmEndpointStore(db), models, cipher);
  const warn = (m: string) => log.warn(m);
  const router = new KbLlmRouter(deps.llm.batch, deps.llm.chat, llmProps, models, warn);
  const batch = new BatchLlmExecutor(deps.llm.batch, quotaTracker);
  const sync = new SyncLlmExecutor(deps.llm.chat, llmProps, quotaTracker, endpoints, warn);
  const usage = new KbUsageRecorder(new DbKbLlmUsageStore(db), models, router, now);
  const requestStore = new DbKbRunRequestStore(db);
  const submitter = new KbBatchSubmitter(new DbKbBatchJobStore(db), requestStore, new DbKbRunStore(db), batch, router,
    txRunner(db), now, (m) => log.info(m));
  const costs = new KbCostService(db, models, now);
  const quota = new KbQuotaService(quotaTracker, now);
  const progress = new KbProgressService(db, () => sync.concurrency(), now);
  const payloads = new KbPayloads(models);
  const ownSettings = new DbKbSettings(db, pipelineProperties(config), llmProps);
  const settings = (): KbSettingsPort => collaborators(deps).settings ?? ownSettings;
  const forecast = (): KbForecastPort => {
    const f = collaborators(deps).forecast;
    if (!f) throw new Error('KbForecastService is not available (kb-admin registers it with provideKbCollaborators)');
    return f;
  };
  const engine = new KbRunEngine({
    db, storage: deps.storage, log: deps.log.child({ component: 'KbRunEngine' }), now, router, batch, submitter, sync, usage,
    settings, costs, requestStore, background: config.kb.pipeline.background,
  });
  const pipeline = new KbPipelineService({
    db, log: deps.log.child({ component: 'KbPipelineService' }), now, engine, payloads, router, progress, settings, forecast,
    importer: () => collaborators(deps).importer ?? null,
    refreshPrices: () => {
      const c = collaborators(deps).catalog;
      return c ? c.sync('do-catalog').then(() => undefined) : null;
    },
  });
  engine.register(pipeline);
  const retention = new KbRunRetentionService(db, deps.storage, now, deps.log.child({ component: 'KbRunRetentionService' }));
  const kb: KbPipeline = {
    pipeline, engine, router, sync, batch, usage, payloads, endpoints, submitter, costs, quota, progress, retention, inputs,
    quotaTracker, models, settings, forecast,
  };
  instances.set(deps, kb);
  return kb;
}
