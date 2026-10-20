// Port of apps/api/src/main/java/org/ceitba/api/service/kb/KbValidator.java.
//
// The checks of a parsed page that need the database (docs/SUBJECT-WIKI.md):
//   - every [[file:…]] citation is in `sources`;
//   - every source is a PUBLISHED Drive file whose effective subject is the
//     page's subject;
//   - no 40-word run is copied from a source's extracted text.
// The database part is the caller's: it passes what it loaded as SourceInfo.
// TODO(kb-service): KbImportService/KbPipelineService load the Drive files of
// draft.sources (status, effective subject, extracted text, content fingerprint)
// and build the SourceInfo map; one `shingles` cache per import.

import { findCopyIn, shinglesOf, WINDOW, type Shingles } from './kbCopyDetector';
import type { Draft } from './kbPageParser';
import type { Uuid } from './uuid';

/** What the validator needs to know about a cited Drive file. key: its content fingerprint (shingle cache key). */
export interface SourceInfo {
  id: Uuid;
  published: boolean;
  effectiveSubjectId: string | null;
  text: string | null;
  key: string;
}

/** SourceInfo(id, published, effectiveSubjectId, text): key defaults to "file:" + id. */
export function sourceInfo(id: Uuid, published: boolean, effectiveSubjectId: string | null, text: string | null, key?: string): SourceInfo {
  return { id, published, effectiveSubjectId, text, key: key ?? `file:${id}` };
}

/**
 * shingles: per-call cache of each source's copy-detector shingles (by
 * SourceInfo.key), shared by every page of one import.
 */
export function validate(draft: Draft, sources: Map<Uuid, SourceInfo>, shingles: Map<string, Shingles> = new Map()): string[] {
  const errors: string[] = [];
  for (const c of draft.links.citations) {
    if (c.id != null && !draft.sources.includes(c.id)) {
      errors.push(`cites file ${c.id} which is not in sources`);
    }
  }
  const texts: Shingles[] = [];
  for (const id of draft.sources) {
    const info = sources.get(id);
    if (info == null) {
      errors.push(`source ${id} does not exist`);
    } else if (!info.published) {
      errors.push(`source ${id} is not a published file`);
    } else if (draft.subject !== info.effectiveSubjectId) {
      errors.push(`source ${id} is not a file of subject ${draft.subject}`);
    } else {
      let s = shingles.get(info.key);
      if (s === undefined) {
        s = shinglesOf(info.text);
        shingles.set(info.key, s);
      }
      texts.push(s);
    }
  }
  const copied = findCopyIn(draft.body, texts);
  if (copied != null) {
    errors.push(`copies ${WINDOW}+ consecutive words from a source: "${abbreviate(copied)}"`);
  }
  return errors;
}

function abbreviate(s: string): string {
  return s.length <= 120 ? s : s.substring(0, 117) + '...';
}
