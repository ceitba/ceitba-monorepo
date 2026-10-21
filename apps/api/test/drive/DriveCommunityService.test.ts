// Port of apps/api/src/test/java/org/ceitba/api/service/drive/DriveCommunityServiceTest.java
import { describe, expect, test } from 'bun:test';
import { communityCodes, communitySubjectFor } from '../../src/features/drive/logic/driveCommunity';

describe('DriveCommunityServiceTest', () => {
  test('folderNamesMapToTheFirstKnownSubjectCode', () => {
    const known = new Set(['11.77', '12.44', '71.88']);
    const none = new Set<string>();
    expect(communityCodes('12.43 - 12.44 - Ciencia de Materiales')).toEqual(['12.43', '12.44']);
    expect(communitySubjectFor('11.77 - Estadística Aplicada 1', known, none)).toBe('11.77');
    // The first code is not a subject: the next one is used.
    expect(communitySubjectFor('12.43 - 12.44 - Ciencia de Materiales', known, none)).toBe('12.44');
    // Organizational folders, unknown codes and names without a code are skipped.
    expect(communitySubjectFor('00.00 - Resúmenes', known, none)).toBeNull();
    expect(communitySubjectFor('00.01 Útil', known, none)).toBeNull();
    expect(communitySubjectFor('99.99 - Desconocida', known, none)).toBeNull();
    expect(communitySubjectFor('Varios', known, none)).toBeNull();
    // Dev allowlist.
    expect(communitySubjectFor('11.77 - Estadística Aplicada 1', known, new Set(['71.88']))).toBeNull();
  });
});
