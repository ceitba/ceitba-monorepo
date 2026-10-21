// Port of apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/KbInputs.java.
//
// Change detection (docs/SUBJECT-WIKI-PIPELINE.md): a subject's inputs are its
// PUBLISHED (so not hidden, not removed) files with usable text, as sorted
// {fileId, fingerprint, academicYear}; it is dirty when files were added,
// changed (new fingerprint) or removed since kb_subject_state. Year-only
// changes do not make it dirty. Callers own the transaction (inTx).

import { createHash } from 'node:crypto';
import { asText, elements, path, type JsonObject, type JsonValue, type Node } from '../kb/logic/jsonNode';
import { nodeToString } from '../kb/logic/jsonNode';
import type { KbSubjectState } from './db/entities';
import { files, pages, states } from './db/repo';

/** Below this much extracted text a file is an image/spreadsheet/etc. */
export const MIN_TEXT_CHARS = 200;

export interface Input {
  fileId: string;
  fingerprint: string | null;
  academicYear: number | null;
  name: string;
  chars: number;
}

export class Diff {
  constructor(
    readonly subjectId: string,
    readonly current: Input[],
    readonly added: Input[],
    readonly changed: Input[],
    readonly removed: string[],
    readonly hasState: boolean,
  ) {}

  dirty(): boolean {
    return this.added.length > 0 || this.changed.length > 0 || this.removed.length > 0;
  }

  /** Change size: added + changed chars, then removed count. */
  priority(): number {
    let chars = 0;
    for (const i of this.added) chars += i.chars;
    for (const i of this.changed) chars += i.chars;
    return chars * 1000 + Math.min(this.removed.length, 999);
  }
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Current inputs of every subject with published text (TreeMap by subject, files by id). */
export async function current(): Promise<Map<string, Input[]>> {
  const out = new Map<string, Input[]>();
  for (const r of await files.pipelineInputs(MIN_TEXT_CHARS)) {
    let list = out.get(r.subjectId);
    if (!list) out.set(r.subjectId, (list = []));
    list.push({ fileId: r.id, fingerprint: r.fingerprint, academicYear: r.academicYear, name: r.name, chars: r.chars });
  }
  for (const l of out.values()) l.sort((a, b) => cmp(a.fileId, b.fileId));
  return new Map([...out.entries()].sort((a, b) => cmp(a[0], b[0])));
}

/** Diffs of every subject (not paused) that has inputs, pages or a state. */
export async function diffs(paused: (subjectId: string) => boolean, cur?: Map<string, Input[]>): Promise<Diff[]> {
  const c = cur ?? (await current());
  const stateBySubject = new Map<string, KbSubjectState>();
  for (const s of await states.findAll()) stateBySubject.set(s.subjectId, s);
  const subjects = new Set<string>([...c.keys(), ...stateBySubject.keys(), ...(await subjectsWithPages())]);
  const out: Diff[] = [];
  for (const subject of [...subjects].sort(cmp)) {
    if (paused(subject)) continue;
    out.push(diff(subject, c.get(subject) ?? [], stateBySubject.get(subject) ?? null));
  }
  return out;
}

export function diff(subjectId: string, cur: Input[], state: KbSubjectState | null): Diff {
  const before = new Map<string, string | null>();
  if (state != null) {
    for (const n of elements(state.inputs)) before.set(asText(path(n, 'fileId')), asText(path(n, 'fingerprint'), null));
  }
  const added: Input[] = [];
  const changed: Input[] = [];
  const now = new Set<string>();
  for (const i of cur) {
    now.add(i.fileId);
    if (!before.has(i.fileId)) added.push(i);
    else if (before.get(i.fileId) !== i.fingerprint) changed.push(i);
  }
  const removed = [...before.keys()].filter((id) => !now.has(id)).sort(cmp);
  return new Diff(subjectId, cur, added, changed, removed, state != null);
}

export async function subjectsWithPages(): Promise<string[]> {
  return (await pages.findSubjectIdsWithStatusNot('REMOVED')).sort(cmp);
}

export function toJson(inputs: Input[]): JsonValue[] {
  return inputs.map((i): JsonObject => ({ fileId: i.fileId, fingerprint: i.fingerprint, academicYear: i.academicYear }));
}

/** sha256 hex of the inputs' compact JSON. */
export function hash(inputs: Node): string {
  return createHash('sha256').update(nodeToString(inputs), 'utf8').digest('hex');
}
