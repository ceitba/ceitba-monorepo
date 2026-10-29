// The pure parts of apps/api/src/main/java/org/ceitba/api/service/drive/DriveCommunityService.java.
//
// A community root's top-level folder named "<code> - <name>" ("11.77 -
// Estadística Aplicada 1", "12.43 - 12.44 - Ciencia de Materiales") maps to
// the first of its leading codes that exists in public.subject. Skipped:
// names starting with "00." (organizational folders), names without a
// leading code, unknown codes and, when DRIVE_SYNC_COMMUNITY_ONLY_CODES is
// set (dev), codes not in it.
//
// expandAll()/expand() (list each ACTIVE COMMUNITY_ROOT's children with the
// Drive client, then DriveSyncStore.applyCommunityFolders) are in drive/sync.ts.

import { JAVA_S } from '../../../lib/javaCompat';

const S = JAVA_S;
// Leading "dd.dd" codes, separated by " - ", "-", "/", "," or spaces.
const LEADING_CODES = new RegExp(`^${S}*(\\d{2}\\.\\d{2}(?:${S}*[-/,]?${S}*\\d{2}\\.\\d{2})*)`);
const CODE = /\d{2}\.\d{2}/g;

/** The subject codes at the start of a top-level folder name, in order; empty for "00.xx" folders and names without a code. */
export function communityCodes(folderName: string | null | undefined): string[] {
  if (folderName == null) return [];
  // Java \d is ASCII-only, like JS without the u flag.
  const m = LEADING_CODES.exec(folderName);
  if (!m) return [];
  const out = [...m[1]!.matchAll(CODE)].map((c) => c[0]);
  if (out[0]!.startsWith('00.')) return [];
  return out;
}

/** The subject a folder maps to: its first code that is a known subject (and in onlyCodes when not empty). */
export function communitySubjectFor(folderName: string | null | undefined, knownSubjects: ReadonlySet<string>,
                                    onlyCodes: ReadonlySet<string>): string | null {
  return communityCodes(folderName)
    .filter((code) => knownSubjects.has(code))
    .find((code) => onlyCodes.size === 0 || onlyCodes.has(code)) ?? null;
}

/** DriveSyncStore.CommunityFolder */
export interface CommunityFolder {
  driveId: string;
  name: string;
  subjectId: string;
}
