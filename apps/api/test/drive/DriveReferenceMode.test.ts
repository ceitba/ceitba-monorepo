// Port of apps/api/src/test/java/org/ceitba/api/service/drive/DriveReferenceModeTest.java
import { describe, expect, test } from 'bun:test';
import { driveKindOf } from '../../src/features/drive/logic/driveKinds';
import { byReference, needsFetch, type FetchCandidate } from '../../src/features/drive/logic/driveSyncRules';

const MB = 1024 * 1024;

const pdf = (fingerprint: string, ref: boolean): FetchCandidate => ({
  id: crypto.randomUUID(), driveId: 'd1', kind: 'PDF', name: 'a.pdf', mimeType: 'application/pdf', version: 3,
  md5: 'abc', size: 5 * MB, modifiedAt: null, fingerprint, contentVersion: 3, contentModifiedAt: null,
  exportBlocked: false, byReference: ref,
});

describe('DriveReferenceModeTest', () => {
  test('referenceModeAndSizeThresholdDecideStorageAndAModeChangeRefetches', () => {
    expect(byReference('REFERENCE', 1, 20 * MB)).toBe(true);
    expect(byReference('COPY', 25 * MB, 20 * MB)).toBe(true);
    expect(byReference('COPY', 5 * MB, 20 * MB)).toBe(false);
    expect(byReference('COPY', null, 20 * MB)).toBe(false);

    // Up to date in its mode: nothing to do.
    expect(needsFetch(pdf('md5:abc', false), false)).toBe(false);
    expect(needsFetch(pdf('ref:md5:abc', true), true)).toBe(false);
    // Mode changed (stored copy -> reference, or back): fetched again.
    expect(needsFetch(pdf('md5:abc', false), true)).toBe(true);
    expect(needsFetch(pdf('ref:md5:abc', true), false)).toBe(true);
    // Videos, audio and archives are never rows at all; images only in student sources.
    expect(driveKindOf('video/mp4', 'clase.mp4', true)).toBeNull();
    expect(driveKindOf('application/zip', 'tp.zip', true)).toBeNull();
    expect(driveKindOf('text/x-python', 'tp.py', true)).toBe('OTHER');
    expect(driveKindOf('image/png', 'pizarron.png', false)).toBeNull();
  });
});
