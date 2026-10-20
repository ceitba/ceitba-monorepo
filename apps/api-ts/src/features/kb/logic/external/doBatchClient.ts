// The pure response readers of apps/api/src/main/java/org/ceitba/api/external/llm/DoBatchClient.java.
//
// DigitalOcean serverless inference, batch API (https://inference.do-ai.run).
// Responses are read defensively (field names vary between providers/versions:
// id|batch_id, file_id|id, upload_url|url).
// TODO(kb-service): the HTTP client itself (createFile/upload/createBatch/get/results/download/
// cancel/findByRequestId/probeQuota over fetch, Bearer key, 60 s timeout, x-ratelimit headers to
// DoQuotaTracker.observe, errors as LlmApiError(status, "<METHOD> <path> -> <status>: <body cut at 500>")).

import { equalsIgnoreCase, jIsBlank } from '../javaString';
import { asBoolean, asText, elements, has, hasNonNull, isArray, isBoolean, isObject, isTextual, nodeToString, path, type JsonValue, type Node } from '../jsonNode';
import { BatchInfo, type BatchResults } from './llmApi';

/** DO rejects batch files without a .jsonl extension (400 "file must have a .jsonl extension"). */
export function jsonlFileName(name: string | null): string {
  const base = (name == null || jIsBlank(name) ? 'batch' : name).replace(/[^A-Za-z0-9._-]/gu, '-');
  return base.endsWith('.jsonl') ? base : base + '.jsonl';
}

/**
 * DO answers {result_available, download: {presigned_url, expires_at}} (the output JSONL),
 * not OpenAI's output_file_url/error_file_url: both shapes are read.
 */
export function resultsOf(node: Node): BatchResults {
  let output = text(node, 'output_file_url');
  if (output == null) output = text(path(node, 'download'), 'presigned_url', 'url');
  let errors = text(node, 'error_file_url');
  if (errors == null) errors = text(path(node, 'error_download'), 'presigned_url', 'url');
  const available = asBoolean(path(node, 'result_available'), output != null);
  return { available, outputFileUrl: output, errorFileUrl: errors };
}

/** GET /v1/batches: {edges: [{node: {...}}], page_info} (also data[] / batches[]). */
export function batchList(node: Node): JsonValue[] {
  const out: JsonValue[] = [];
  for (const e of elements(path(node, 'edges'))) out.push(has(e, 'node') ? path(e, 'node')! : e);
  for (const key of ['data', 'batches']) {
    if (isArray(path(node, key))) out.push(...elements(path(node, key)));
  }
  return out;
}

export function info(node: Node): BatchInfo {
  const id = text(node, 'id', 'batch_id');
  let status = text(node, 'status');
  // DO reports "completed" a little before the output/error files exist
  // (result_available false): until they exist it is "finalizing".
  const available = has(node, 'result_available') ? path(node, 'result_available') : path(path(node, 'data'), 'result_available');
  if (equalsIgnoreCase('completed', status) && isBoolean(available) && !available) {
    status = 'finalizing';
  }
  return new BatchInfo(id, status == null ? null : status.toLowerCase(), nodeToString(node), errorMessage(node));
}

/** error_message, else errors.data[0].message / error.message / error. */
export function errorMessage(node: Node): string | null {
  const m = text(node, 'error_message');
  if (m != null) return m;
  const first = path(path(path(node, 'errors'), 'data'), 0);
  if (hasNonNull(first, 'message')) return asText(path(first, 'message'));
  const err = path(node, 'error');
  if (hasNonNull(err, 'message')) return asText(path(err, 'message'));
  if (isTextual(err) && !jIsBlank(err)) return err;
  const data = path(node, 'data');
  return isObject(data) ? errorMessage(data) : null;
}

function text(node: Node, ...names: string[]): string | null {
  for (const n of names) {
    const v = path(node, n);
    if (isTextual(v) && !jIsBlank(v)) return v;
  }
  const data = path(node, 'data');
  if (isObject(data)) return text(data, ...names);
  return null;
}
