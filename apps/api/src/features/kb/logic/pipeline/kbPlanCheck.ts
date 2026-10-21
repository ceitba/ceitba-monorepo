// Port of apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/KbPlanCheck.java.
//
// What validating one PLAN answer kept and dropped (count per reason),
// shared by the pipeline and evals. Dropped operations are logged and
// recorded (kb_run.stats.droppedPlanOps / eval results) instead of
// vanishing; a plan whose operations were all dropped is asked once more.

import { equalsIgnoreCase, lowerRoot } from '../javaString';
import { isEmpty, size, type JsonObject, type Node } from '../jsonNode';
import { javaTrim } from '../../../../lib/javaCompat';

export const NO_SOURCES = 'noSources'; // create/update with an empty `sources`
export const UNKNOWN_SOURCES = 'unknownSources'; // only ids that are not inputs of the subject
export const INVALID_SLUG = 'invalidSlug';
export const DUPLICATE_SLUG = 'duplicateSlug';
export const INVALID_OP = 'invalidOp'; // not create/update/delete
export const UNKNOWN_PAGE = 'unknownPage'; // update/delete of a page that does not exist
export const DELETE_IGNORED = 'deleteIgnored'; // evals rebuild from scratch: no deletes

export const EMPTY_PLAN_ERROR = 'plan returned no operations with valid sources';
export const INDEX_ONLY_ERROR =
  'plan_insufficient: a first compilation with several sources ' +
  'planned only the index page (no topic or concept pages)';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class KbPlanCheck {
  private readonly proposedCount: number;
  private keptN = 0;
  private readonly droppedMap = new Map<string, number>();
  private contentKept = 0; // kept create/update operations that are not the index
  private firstCompileSources = 0; // >= 2: a first compilation whose plan must have more than the index

  constructor(proposed: Node) {
    this.proposedCount = proposed == null ? 0 : size(proposed);
  }

  kept(): void {
    this.keptN++;
  }

  /** A kept create/update of the page `slug`. */
  keptPage(slug: string): void {
    this.kept();
    if (slug !== 'index') this.contentKept++;
  }

  /** First compilation (no existing pages) from `usableSources` files: with two or more, index-only is not enough. */
  firstCompile(usableSources: number): void {
    this.firstCompileSources = usableSources;
  }

  indexOnly(): boolean {
    return this.firstCompileSources >= 2 && this.keptN > 0 && this.contentKept === 0;
  }

  /** Nothing usable: all operations dropped, or (first compilation) only an index. */
  insufficient(): boolean {
    return this.emptyAfterFiltering() || this.indexOnly();
  }

  dropped(reason: string): void {
    this.droppedMap.set(reason, (this.droppedMap.get(reason) ?? 0) + 1);
  }

  /** The reason a create/update has no usable source: none given, or only unknown ids. */
  droppedForSources(given: Node): void {
    this.dropped(given == null || isEmpty(given) ? NO_SOURCES : UNKNOWN_SOURCES);
  }

  proposed(): number {
    return this.proposedCount;
  }

  keptCount(): number {
    return this.keptN;
  }

  /** TreeMap order: by reason. */
  droppedByReason(): Map<string, number> {
    return new Map([...this.droppedMap.entries()].sort(([a], [b]) => cmp(a, b)));
  }

  anyDropped(): boolean {
    return this.droppedMap.size > 0;
  }

  /** The model proposed operations but none survived validation. */
  emptyAfterFiltering(): boolean {
    return this.proposedCount > 0 && this.keptN === 0;
  }

  toJson(): JsonObject {
    const d: JsonObject = {};
    for (const [k, v] of this.droppedByReason()) d[k] = v;
    return { proposed: this.proposedCount, kept: this.keptN, dropped: d };
  }
}

/** "indice"/"índice" of an index page is the slug "index". */
export function normalizeIndexSlug(slug: string, type: string | null): string {
  if (type == null || !equalsIgnoreCase(javaTrim(type), 'index')) return slug;
  const folded = lowerRoot(slug.normalize('NFD').replace(/\p{M}+/gu, ''));
  return folded === 'indice' ? 'index' : slug;
}

/** The corrective note appended to a PLAN request whose operations were all dropped. */
export function correction(validIds: Iterable<string>, indexOnly = false): string {
  const ids = [...validIds].join(', ');
  if (indexOnly) {
    return (
      '## Corrección\n\nYour previous plan only created the `index` page. This subject has several ' +
      'sources and no pages yet: plan the topic and concept pages too (one `create` per topic or concept ' +
      'the sources teach, each with `sources` copied exactly from the valid ids), plus the index. Answer ' +
      'again with `submit_plan`.\n\nValid ids: ' + ids
    );
  }
  return (
    '## Corrección\n\nIn your previous answer no operation could be used: every `create` and `update` ' +
    'needs `sources` with at least one id copied exactly from this list of valid file ids (no names, no ' +
    'invented ids). Answer again with `submit_plan`.\n\nValid ids: ' + ids
  );
}
