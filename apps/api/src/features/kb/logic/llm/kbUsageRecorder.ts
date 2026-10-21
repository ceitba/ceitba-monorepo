// Port of apps/api/src/main/java/org/ceitba/api/service/kb/llm/KbUsageRecorder.java.
//
// Writes one kb_llm_usage row per request result, priced at the catalog
// price of this moment (frozen). Runs in the caller's transaction.

import type { Dec } from '../decimal';
import type { Now } from '../odt';
import type { KbLlmUsageStore, KbModelReader } from '../ports';
import type { KbLlmRouter } from './kbLlmRouter';
import { cost } from './kbPricing';

export class KbUsageRecorder {
  constructor(
    private readonly usage: KbLlmUsageStore,
    private readonly models: KbModelReader,
    private readonly router: KbLlmRouter,
    private readonly now: Now,
  ) {}

  /** One HTTP call: attempt is 1-based per request; latencyMs (sync) and reasoningTokens may be null. */
  async record(
    runId: string | null,
    evalId: string | null,
    requestId: string | null,
    model: string,
    mode: string,
    stage: string,
    subjectId: string | null,
    input: number,
    cached: number,
    output: number,
    attempt = 1,
    latencyMs: number | null = null,
    reasoningTokens: number | null = null,
  ): Promise<Dec> {
    const price = cost(await this.models.findById(model), mode, input, cached, output);
    await this.usage.save({
      createdAt: this.now(),
      runId,
      evalId,
      requestId,
      model,
      mode,
      stage,
      subjectId,
      inputTokens: input,
      cachedInputTokens: cached,
      outputTokens: output,
      costUsd: price,
      simulated: this.router.simulated(),
      attempt,
      latencyMs,
      reasoningTokens,
    });
    return price;
  }
}
