// The kb-admin beans, one set per Deps (constructors do no I/O). See API.md.
//
//   import { kbAdmin } from '../kb-admin/service';
//   const admin = kbAdmin(deps);
//   admin.settings.effective()          KbSettingsService
//   admin.forecast.subjectEstimates()   KbForecastService
//   admin.catalog.sync()                KbModelCatalogService
//   admin.endpoints / admin.evals       KbEndpointService / KbEvalService
//
// Building it registers settings, forecast and catalog with kb-pipeline
// (provideKbCollaborators), so the pipeline uses these instead of its fallbacks.

import type { Deps } from '../../deps';
import { KbModelCatalogService as ProbeLogic } from '../kb/logic/admin/kbModelCatalogService';
import { KbEndpointRegistry } from '../kb/logic/llm/kbEndpointRegistry';
import { KbSecretCipher } from '../kb/logic/llm/kbSecretCipher';
import { provideKbCollaborators } from '../kb-pipeline/collaborators';
import { KbModelCatalogService, modelStore } from './catalog';
import { KbEndpointService } from './endpoints';
import { KbEvalService } from './evals';
import { KbForecastService } from './forecast';
import { KbSettingsService } from './settings';
import { kbTx } from './tx';
import { nowOdt } from './values';
import { pipelineBeans } from './pipeline';

export interface KbAdminBeans {
  settings: KbSettingsService;
  forecast: KbForecastService;
  catalog: KbModelCatalogService;
  endpoints: KbEndpointService;
  evals: KbEvalService;
  cipher: KbSecretCipher;
}

const beans = new WeakMap<Deps, KbAdminBeans>();

export function kbAdmin(deps: Deps): KbAdminBeans {
  let b = beans.get(deps);
  if (b) return b;
  const forecast = new KbForecastService(deps);
  const settings = new KbSettingsService(deps, () => forecast);
  const cipher = new KbSecretCipher(deps.config.kb.secretsKey, deps.config.auth.jwt.secret);
  // The process' endpoint registry (in-flight and error counters of the executors).
  const registry = (): KbEndpointRegistry => pipelineBeans(deps).endpoints;
  const probes = (): ProbeLogic => {
    const p = pipelineBeans(deps);
    return new ProbeLogic(modelStore(deps), settings, p.router, p.sync, p.batch, p.payloads, p.usage,
      (fn) => kbTx(deps.db, () => Promise.resolve(fn())), () => nowOdt(deps), (m) => deps.log.info(m));
  };
  const catalog = new KbModelCatalogService(deps, settings, probes);
  const endpoints = new KbEndpointService(deps, settings, cipher, registry);
  const evals = new KbEvalService(deps, settings, () => pipelineBeans(deps));
  b = { settings, forecast, catalog, endpoints, evals, cipher };
  beans.set(deps, b);
  provideKbCollaborators(deps, { settings, forecast, catalog });
  // Evaluations are runs of the pipeline's engine (KbRunHandler for trigger EVAL).
  pipelineBeans(deps).engine.register(evals);
  return b;
}
