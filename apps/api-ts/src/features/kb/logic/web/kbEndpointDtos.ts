// Port of apps/api/src/main/java/org/ceitba/api/web/kb/admin/KbEndpointDtos.java.
// Custom OpenAI-compatible endpoints (docs/SUBJECT-WIKI-ADMIN.md, "Custom endpoints").
// The API key is write-only: responses only say hasKey (and keyReadable).
// Key order = Java record component order (Jackson output order).

import type { Odt } from '../odt';

/** hasKey && !keyReadable: AUTH_JWT_SECRET / KB_SECRETS_KEY changed since the token was saved. */
export interface Item {
  id: string;
  name: string;
  baseUrl: string;
  hasKey: boolean;
  keyReadable: boolean;
  maxConcurrency: number;
  timeoutSec: number;
  enabled: boolean;
  modelCount: number;
  createdAt: Odt;
  updatedAt: Odt;
}

export function item(
  id: string,
  name: string,
  baseUrl: string,
  hasKey: boolean,
  keyReadable: boolean,
  maxConcurrency: number,
  timeoutSec: number,
  enabled: boolean,
  modelCount: number,
  createdAt: Odt,
  updatedAt: Odt,
): Item {
  return { id, name, baseUrl, hasKey, keyReadable, maxConcurrency, timeoutSec, enabled, modelCount, createdAt, updatedAt };
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  models: string[];
  error: string | null;
}

export interface DiscoverResult {
  added: string[];
  existing: string[];
}

export interface Stats {
  windowMinutes: number;
  requests: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  outputTokensPerSec: number;
  inFlight: number;
}
