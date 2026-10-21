// Beans of the other kb agents' packages that the pipeline calls (see API.md):
// KbSettingsService.effective(), KbForecastService.nextRunTotal/subjectEstimates,
// KbImportService.validate/importSubject and KbModelCatalogService.sync. The
// owners register them with provideKbCollaborators(deps, {...}) when their routes
// are built. Without them: settings fall back to settings.ts (same merge), DETECT
// fails without a forecast, PUBLISH fails the subject without an importer, and the
// weekly price refresh and probe refresh are skipped.

import type { Db } from '../../db/client';
import type { Deps } from '../../deps';
import type { Dec } from '../kb/logic/decimal';
import type { KbEffectiveSettings } from '../kb/logic/admin/kbSettings';
import type { Diff } from './inputs';

export interface KbSettingsPort {
  effective(): Promise<KbEffectiveSettings>;
  /** Hard caps from the environment (never STAFF-settable). */
  maxRequestsPerStage(): number;
  digestMaxMissingRatio(): number;
  batchMaxRequests(): number;
}

export interface SubjectEstimate {
  subjectId: string;
  costUsd: Dec;
  inputTokens: number;
}

export interface KbForecastPort {
  nextRunTotal(s: KbEffectiveSettings): Promise<Dec>;
  subjectEstimates(s: KbEffectiveSettings, dirty: Diff[]): Promise<Map<string, SubjectEstimate>>;
}

/** web/kb/dto/KbImportPage. */
export interface KbImportPage {
  path: string;
  content: string;
}

/** web/kb/dto/KbRejectedPage. */
export interface KbRejectedPage {
  slug: string;
  errors: string[];
}

export interface KbImportValidation {
  rejected: KbRejectedPage[];
}

export interface KbImportResult {
  accepted: string[];
  rejected: KbRejectedPage[];
  removed: string[];
}

/**
 * KbImportService. The pipeline calls both inside its kb transaction and passes that
 * drizzle transaction as `tx` (pending entities already flushed): use it (withTx(tx, ...)
 * joins it), so a publish is one transaction like Java's.
 */
export interface KbImporterPort {
  validate(subjectId: string, payload: KbImportPage[], removing: Set<string>, tx?: Db): Promise<KbImportValidation>;
  importSubject(subjectId: string, req: { pages: KbImportPage[]; replace: boolean }, tx?: Db): Promise<KbImportResult>;
}

export interface KbCatalogPort {
  /** KbModelCatalogService.sync(source): the weekly price refresh before a scheduled run. */
  sync(source: string): Promise<unknown>;
  /** KbModelCatalogService.refreshPendingProbes (the batch poller). */
  refreshPendingProbes?(): Promise<unknown>;
}

export interface KbEvalsPort {
  /** KbEvalService.ensureDefaultSet (KbPipelineJob.onStartup). */
  ensureDefaultSet(): Promise<unknown>;
}

export interface KbCollaborators {
  settings?: KbSettingsPort;
  forecast?: KbForecastPort;
  importer?: KbImporterPort;
  catalog?: KbCatalogPort;
  evals?: KbEvalsPort;
}

const registry = new WeakMap<Deps, KbCollaborators>();

/** Registers (or replaces) the given collaborators for this process' deps. */
export function provideKbCollaborators(deps: Deps, c: KbCollaborators): void {
  registry.set(deps, { ...(registry.get(deps) ?? {}), ...c });
}

export function collaborators(deps: Deps): KbCollaborators {
  return registry.get(deps) ?? {};
}
