// config/DriveSyncProperties: drive-sync.* (src/config/sections/content.ts)
// with the record's normalization (non-positive -> default, lists trimmed).
import type { Config } from '../../config';

export interface DriveSyncProps {
  enabled: boolean;
  intervalMs: number;
  runBudgetMs: number;
  serviceAccountJson: string;
  useFake: boolean;
  maxFileBytes: number;
  fakeDemoOwners: string[];
  sourceBudgetMs: number;
  referenceAboveBytes: number;
  maxItemsPerSource: number;
  maxDepth: number;
  communityEnabled: boolean;
  communityOnlyCodes: string[];
}

const positiveOr = (v: number, d: number) => (Number.isFinite(v) && v > 0 ? v : d);
const list = (xs: string[]) => xs.filter((s) => s != null && s.trim() !== '').map((s) => s.trim());

export function driveProps(config: Config): DriveSyncProps {
  const d = config.content.driveSync;
  return {
    enabled: d.enabled,
    intervalMs: positiveOr(d.intervalMs, 30 * 60_000),
    runBudgetMs: positiveOr(d.runBudgetMs, 10 * 60_000),
    serviceAccountJson: d.serviceAccountJson,
    useFake: d.useFake,
    maxFileBytes: positiveOr(d.maxFileBytes, 50 * 1024 * 1024),
    fakeDemoOwners: list(d.fakeDemoOwners),
    sourceBudgetMs: positiveOr(d.sourceBudgetMs, 3 * 60_000),
    referenceAboveBytes: positiveOr(d.referenceAboveBytes, 20 * 1024 * 1024),
    maxItemsPerSource: positiveOr(d.maxItemsPerSource, 20_000),
    maxDepth: positiveOr(d.maxDepth, 30),
    communityEnabled: d.communityEnabled,
    communityOnlyCodes: list(d.communityOnlyCodes),
  };
}
