// SubjectMatcher.normalize (apps/api/src/main/java/org/ceitba/api/service/drive/SubjectMatcher.java),
// the only part of the Drive subject matcher the kb logic uses.
// TODO(kb-service): move to the drive feature when SubjectMatcher is ported, and import it from there.

import { jTrim, lowerRoot } from './javaString';

export function normalizeRaw(s: string): string {
  return lowerRoot(s.normalize('NFD').replace(/\p{M}+/gu, ''));
}

/** Accents and case folded, anything but [a-z0-9] runs -> one space, trimmed. */
export function normalize(s: string): string {
  return jTrim(normalizeRaw(s).replace(/[^a-z0-9]+/gu, ' '));
}
