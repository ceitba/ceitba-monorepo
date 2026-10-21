// KbPipelineService.compiledInputs (apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/
// KbPipelineService.java), the pure step of PUBLISH.
// The rest of KbPipelineService is src/features/kb-pipeline/pipeline.ts.

import { asText, elements, path, type JsonValue, type Node } from '../jsonNode';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * After PUBLISH only the inputs of pages that made it in count as compiled: the
 * current version of every input no failed page used; for a `tainted` one (a source
 * of a failed page) its previously compiled version, or nothing if it was new, so the
 * next run sees it as changed/added (or removed) again. Ordered by fileId (TreeMap).
 */
export function compiledInputs(previous: Node, current: Node, tainted: Set<string>): JsonValue[] {
  const before = new Map<string, JsonValue>();
  if (previous != null) for (const i of elements(previous)) before.set(asText(path(i, 'fileId')), i);
  const out = new Map<string, JsonValue>();
  for (const i of elements(current)) {
    const id = asText(path(i, 'fileId'));
    if (!tainted.has(id)) out.set(id, i);
    else if (before.has(id)) out.set(id, before.get(id)!);
  }
  for (const [id, i] of before) {
    if (tainted.has(id) && !out.has(id)) out.set(id, i); // removed, still cited
  }
  return [...out.keys()].sort(cmp).map((k) => out.get(k)!);
}
