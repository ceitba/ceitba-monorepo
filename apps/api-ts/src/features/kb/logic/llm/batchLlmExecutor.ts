// Port of apps/api/src/main/java/org/ceitba/api/service/kb/llm/BatchLlmExecutor.java.
//
// BATCH mode: one DO batch per call of submit(); polled by the run engine.
// Java streams the JSONL through a temp file; here it is built in memory.
// TODO(kb-service): collectToFiles (download to temp files + streaming parse) for big outputs.

import { DoBatchSlotError, LlmApiError, type BatchInfo, type LlmBatchClient } from '../external/llmApi';
import type { DoQuotaTracker } from '../external/doQuotaTracker';
import { parse, type LlmResult } from '../external/llmOutputParser';
import { nodeToString } from '../jsonNode';
import { batchLine, batchProvider, CHAT_ENDPOINT } from './kbChatPayloads';
import type { LineSource, LlmLine } from './syncLlmExecutor';

export interface Submitted {
  fileId: string;
  batchId: string | null;
}

export interface Collected {
  results: Map<string, LlmResult>;
  output: Uint8Array | null;
  errors: Uint8Array | null;
}

const encoder = new TextEncoder();

export class BatchLlmExecutor {
  constructor(
    private readonly client: LlmBatchClient,
    private readonly quota: DoQuotaTracker | null = null,
  ) {}

  /** Throws DoBatchSlotError (without calling DO) while the last quota snapshot says no creation is left. */
  private checkSlot(): void {
    if (this.quota == null) return;
    const w = this.quota.batchCreationWait();
    if (w != null) throw new DoBatchSlotError(w.reason, w.until);
  }

  /** model: the catalog id (decides the provider); batchModelId: the id the JSONL lines carry. */
  async submit(name: string, model: string, batchModelId: string | null, lines: LineSource, requestId: string | null): Promise<Submitted> {
    const provider = batchProvider(model);
    if (provider == null) throw new LlmApiError(0, model + ' has no batch support');
    this.checkSlot();
    let jsonl = '';
    for await (const l of lines as AsyncIterable<LlmLine>) {
      jsonl += nodeToString(batchLine(l.customId, l.params, provider, batchModelId)) + '\n';
    }
    const file = await this.client.createFile(name);
    await this.client.upload(file.uploadUrl, encoder.encode(jsonl));
    const info = await this.client.createBatch(file.fileId, requestId, provider, provider === 'openai' ? CHAT_ENDPOINT : null);
    return { fileId: file.fileId, batchId: info.id };
  }

  /** The batch DO created for this request_id earlier, if it lists one. */
  async findByRequestId(requestId: string | null): Promise<BatchInfo | null> {
    return this.client.findByRequestId ? this.client.findByRequestId(requestId) : null;
  }

  poll(batchId: string): Promise<BatchInfo> {
    return this.client.get(batchId);
  }

  /** Output and error files of a finished batch (partial for failed/expired). Output lines win over error lines. */
  async collect(batchId: string, completed: boolean): Promise<Collected> {
    let out: Uint8Array | null = null;
    let err: Uint8Array | null = null;
    try {
      const res = await this.client.results(batchId);
      if (res.outputFileUrl != null) out = await this.client.download(res.outputFileUrl);
      if (res.errorFileUrl != null) err = await this.client.download(res.errorFileUrl);
    } catch (e) {
      if (!(e instanceof LlmApiError) || completed) throw e;
    }
    // Java fills a HashMap (iteration order unspecified); here: error ids first, then output ids.
    const parsed = new Map<string, LlmResult>();
    for (const [k, v] of parse(err)) parsed.set(k, v);
    for (const [k, v] of parse(out)) parsed.set(k, v);
    return { results: parsed, output: out, errors: err };
  }

  cancel(batchId: string): Promise<void> {
    return this.client.cancel(batchId);
  }
}
