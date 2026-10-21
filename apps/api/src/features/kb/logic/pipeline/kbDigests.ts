// Port of apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/KbDigests.java.
//
// Deterministic merge of a multi-chunk file's digests (no LLM): topics in
// order, same-name topics (accent/case-insensitive) merged; materialKind,
// unitHint and language from the first chunk that has them.

import { jIsBlank, jStrip } from '../javaString';
import { asText, deepCopy, elements, hasNonNull, path, type JsonObject, type JsonValue } from '../jsonNode';
import { normalize } from '../subjectNormalize';

/**
 * Like merge, for a file some of whose chunks failed (null entries, by chunk index):
 * the digest of the ones that worked, flagged partial: true with failedChunks (0-based).
 */
export function mergePartial(chunks: (JsonValue | null)[]): JsonObject {
  const out = merge(chunks);
  const failed: number[] = [];
  for (let i = 0; i < chunks.length; i++) if (chunks[i] == null) failed.push(i);
  if (failed.length > 0) {
    out.partial = true;
    out.failedChunks = failed;
  }
  return out;
}

/** Subjects' files without a digest: the ones to leave out, or null when the subject must fail. */
export function tolerableMissing(missing: string[], total: number, maxRatio: number): string[] | null {
  if (missing.length === 0) return missing;
  if (missing.length >= total || missing.length > total * maxRatio) return null;
  return missing;
}

export function merge(chunks: (JsonValue | null)[]): JsonObject {
  const out: JsonObject = {};
  const topics = new Map<string, JsonObject>();
  for (const c of chunks) {
    if (c == null) continue;
    for (const field of ['materialKind', 'unitHint', 'language']) {
      if (!hasNonNull(out, field) && hasNonNull(c, field)) out[field] = path(c, field)!;
    }
    for (const t of elements(path(c, 'topics'))) {
      const name = jStrip(asText(path(t, 'name'), '')!);
      if (name.length === 0) continue;
      const key = normalize(name);
      const existing = topics.get(key);
      if (existing === undefined) {
        topics.set(key, deepCopy(t) as JsonObject);
        continue;
      }
      for (const list of ['aliases', 'keyPoints', 'formulas']) {
        const merged = new Set<string>();
        for (const v of elements(path(existing, list))) merged.add(asText(v));
        for (const v of elements(path(t, list))) merged.add(asText(v));
        // putArray replaces the value in place (key position kept) or appends it.
        existing[list] = [...merged];
      }
      const summary = asText(path(existing, 'summary'), '')!;
      const more = asText(path(t, 'summary'), '')!;
      if (!jIsBlank(more) && !summary.includes(more)) existing.summary = jStrip(summary + ' ' + more);
    }
  }
  out.topics = [...topics.values()];
  return out;
}
