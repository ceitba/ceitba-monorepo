// Port of apps/api/src/main/java/org/ceitba/api/config/KbLlmProperties.java (the record's
// normalization), built from config.kb.llm by llmProperties() in src/features/kb-pipeline/settings.ts.

import { jIsBlank, jTrim, lowerRoot } from '../javaString';

export interface KbLlmProperties {
  baseUrl: string;
  apiKey: string | null;
  executionMode: string;
  syncConcurrency: number;
  useFake: boolean;
  requestTimeoutMs: number;
}

/** new KbLlmProperties(baseUrl, apiKey, executionMode, syncConcurrency, useFake[, requestTimeout]). */
export function kbLlmProperties(
  baseUrl: string | null,
  apiKey: string | null,
  executionMode: string | null,
  syncConcurrency: number | null,
  useFake: boolean,
  requestTimeoutMs: number | null = null,
): KbLlmProperties {
  return {
    baseUrl: baseUrl == null || jIsBlank(baseUrl) ? 'https://inference.do-ai.run' : jTrim(baseUrl),
    apiKey,
    executionMode: executionMode == null || jIsBlank(executionMode) ? 'auto' : lowerRoot(jTrim(executionMode)),
    syncConcurrency: syncConcurrency == null || syncConcurrency < 1 ? 16 : syncConcurrency,
    useFake,
    requestTimeoutMs: requestTimeoutMs == null || requestTimeoutMs <= 0 ? 5 * 60_000 : requestTimeoutMs,
  };
}

export const hasKey = (p: KbLlmProperties): boolean => p.apiKey != null && !jIsBlank(p.apiKey);
