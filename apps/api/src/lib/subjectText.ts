// SubjectMatcher.normalizeRaw / normalize (apps/api/src/main/java/org/ceitba/api/service/drive/SubjectMatcher.java),
// shared by the Drive subject matcher and the kb pipeline (digests, payloads).

import { javaTrim } from './javaCompat';

/** Normalizer NFD + strip \p{M} + toLowerCase(Locale.ROOT). */
export function foldAccentsLower(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** SubjectMatcher.normalize: accents and case folded, anything but [a-z0-9] runs -> one space, trimmed. */
export function normalizeSubjectText(s: string): string {
  return javaTrim(foldAccentsLower(s).replace(/[^a-z0-9]+/g, ' '));
}
