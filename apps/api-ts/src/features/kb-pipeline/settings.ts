// KbSettingsService.effective() for the pipeline: the env defaults
// (config/KbPipelineProperties + KbLlmProperties, built from config.kb) merged with
// the single kb_pipeline_settings row (logic/admin/kbSettings.ts). The admin
// agent's KbSettingsService replaces it through provideKbCollaborators.

import type { Config } from '../../config';
import type { Database } from '../../db/client';
import { Dec } from '../kb/logic/decimal';
import { KbSettingsLogic, kbPipelineProperties, type KbEffectiveSettings, type KbPipelineProperties } from '../kb/logic/admin/kbSettings';
import type { JsonObject } from '../kb/logic/jsonNode';
import { kbLlmProperties, type KbLlmProperties } from '../kb/logic/llm/kbLlmProperties';
import type { KbSettingsPort } from './collaborators';
import { settingsRow } from './db/repo';
import { inTx } from './db/session';

export function pipelineProperties(config: Config): KbPipelineProperties {
  const p = config.kb.pipeline;
  let cost: Dec | null;
  try {
    cost = Dec.parse(p.runCostBudgetUsd);
  } catch {
    cost = null;
  }
  return kbPipelineProperties({
    enabled: p.enabled, cron: p.cron, pollIntervalMs: p.pollIntervalMs, modelDigest: p.modelDigest,
    modelPlan: p.modelPlan, modelWrite: p.modelWrite, modelRetry: p.modelRetry, runTokenBudget: p.runTokenBudget,
    retryRejected: p.retryRejected, background: p.background, runTokenBudgetMax: p.runTokenBudgetMax,
    maxRequestsPerStage: p.maxRequestsPerStage, batchMaxRequests: p.batchMaxRequests,
    digestMaxMissingRatio: p.digestMaxMissingRatio, runCostBudgetUsd: cost,
  });
}

export function llmProperties(config: Config): KbLlmProperties {
  const l = config.kb.llm;
  return kbLlmProperties(l.baseUrl, l.apiKey, l.executionMode, l.syncConcurrency, l.useFake, l.requestTimeoutMs);
}

export class DbKbSettings implements KbSettingsPort {
  private readonly logic: KbSettingsLogic;

  constructor(private readonly db: Database, private readonly env: KbPipelineProperties, llm: KbLlmProperties) {
    this.logic = new KbSettingsLogic(env, llm);
  }

  effective(): Promise<KbEffectiveSettings> {
    return inTx(this.db, async () => this.logic.merge((await settingsRow.stored()) as JsonObject));
  }

  maxRequestsPerStage(): number {
    return this.env.maxRequestsPerStage;
  }

  digestMaxMissingRatio(): number {
    return this.env.digestMaxMissingRatio;
  }

  batchMaxRequests(): number {
    return this.env.batchMaxRequests;
  }
}
