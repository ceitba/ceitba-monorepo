// Port of apps/api/src/main/java/org/ceitba/api/service/kb/llm/KbLlmRouter.java.
//
// Execution mode per model: BATCH (DO batch API; only anthropic-*/openai-*
// commercial models) or SYNC (chat completions one by one).
//   auto  -> BATCH when the model supports it, else SYNC
//   batch -> BATCH; a model without batch support falls back to SYNC
//   sync  -> SYNC

import { FakeLlmBatchClient } from '../external/fakeLlm';
import type { LlmBatchClient, SyncChatClient } from '../external/llmApi';
import { jIsBlank, lowerRoot } from '../javaString';
import type { KbModelReader } from '../ports';
import { batchByRule, batchProvider, defaultBatchModelId } from './kbChatPayloads';
import { isCustom } from './kbEndpointRegistry';
import type { KbLlmProperties } from './kbLlmProperties';

export class KbLlmRouter {
  constructor(
    private readonly batch: LlmBatchClient,
    private readonly sync: SyncChatClient,
    private readonly props: KbLlmProperties | null,
    private readonly models: KbModelReader | null,
    private readonly warn: (msg: string) => void = () => {},
  ) {}

  /** Catalog batchSupported (rule or probe), else the rule. */
  async batchSupported(model: string): Promise<boolean> {
    if (batchProvider(model) == null) return false; // DO batches take only these providers
    const m = await this.models!.findById(model);
    return m != null ? m.isBatchSupported() : batchByRule(model);
  }

  /**
   * The model id batch JSONL lines carry: the catalog's batchModelId, else the
   * catalog id without its openai-/anthropic- prefix (Optional.map of a null getter is empty).
   */
  async batchModelId(model: string): Promise<string | null> {
    const m = await this.models!.findById(model);
    return m?.getBatchModelId() ?? defaultBatchModelId(model);
  }

  async modeFor(model: string, executionMode: string | null): Promise<'BATCH' | 'SYNC'> {
    const mode = executionMode == null ? this.props!.executionMode : lowerRoot(executionMode);
    const batchCapable = await this.batchSupported(model);
    switch (mode) {
      case 'sync':
        return 'SYNC';
      case 'batch':
        if (!batchCapable) this.warn(`KB pipeline: ${model} has no batch support; using sync`);
        return batchCapable ? 'BATCH' : 'SYNC';
      default:
        return batchCapable ? 'BATCH' : 'SYNC';
    }
  }

  available(): boolean {
    return this.batch.available() && this.sync.available();
  }

  /** Inference can start when every model is custom (own endpoint, no DO key) or the DO key is configured. */
  availableFor(models: (string | null)[]): boolean {
    const needsDo = models.some((m) => m != null && !jIsBlank(m) && !isCustom(m));
    return !needsDo || this.available();
  }

  availableIn(model: string, mode: string): boolean {
    if (isCustom(model)) return true;
    return this.availableMode(mode);
  }

  availableMode(mode: string): boolean {
    return mode === 'BATCH' ? this.batch.available() : this.sync.available();
  }

  /** Results come from the fake executors (KB_LLM_USE_FAKE): recorded as simulated. */
  simulated(): boolean {
    return (this.props?.useFake ?? false) || this.batch instanceof FakeLlmBatchClient;
  }
}
