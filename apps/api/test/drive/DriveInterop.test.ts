// `interop:` matrices for the drive pure logic, against values produced by the
// Java classes (no Java @Test counterpart; see test/interop/java-golden.ts).
import { describe, expect, test } from 'bun:test';
import { javaUriCreate, javaUriDecode } from '../../src/lib/javaUri';
import { academicYearFromName } from '../../src/features/drive/logic/academicYears';
import { communityCodes } from '../../src/features/drive/logic/driveCommunity';
import { parseDriveFolderUrl } from '../../src/features/drive/logic/driveFolderUrls';
import { SubjectMatcher } from '../../src/features/drive/logic/subjectMatcher';
import { INTEROP } from '../interop/java-golden';

describe('interop: drive pure logic against Java', () => {
  test('java.net.URI parsing (scheme|host|rawPath|rawQuery|rawFragment|path)', () => {
    for (const [u, expected] of INTEROP.uris) {
      let got: string;
      try {
        const x = javaUriCreate(u);
        got = [x.scheme, x.host, x.rawPath, x.rawQuery, x.rawFragment, javaUriDecode(x.rawPath)].map(String).join('|');
      } catch {
        got = 'ERR';
      }
      expect([u, got]).toEqual([u, expected]);
    }
  });

  test('AcademicYears.fromName', () => {
    for (const [n, y] of INTEROP.academicYears) expect([n, academicYearFromName(n, 2026)]).toEqual([n, y]);
  });

  test('DriveFolderUrls.parse', () => {
    for (const [n, id] of INTEROP.folderUrls) expect([n, parseDriveFolderUrl(n)]).toEqual([n, id]);
  });

  test('SubjectMatcher.match with a plan', () => {
    const m = new SubjectMatcher(new Map([['93.41', 'Física I'], ['93.42', 'Física II'], ['72.34', 'Estructuras de Datos y Algoritmos'],
      ['94.24', 'Metodología del Aprendizaje']]), ['94.24']);
    for (const [n, id] of INTEROP.subjectMatches) expect([n, m.match(n)]).toEqual([n, id]);
  });

  test('DriveCommunityService.codes', () => {
    for (const [n, codes] of INTEROP.communityCodes) expect([n, communityCodes(n)]).toEqual([n, codes]);
  });
});
