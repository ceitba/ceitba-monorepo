// Port of apps/api/src/test/java/org/ceitba/api/service/kb/KbCopyDetectorTest.java
import { describe, expect, test } from 'bun:test';
import { findCopy } from '../../src/features/kb/logic/kbCopyDetector';
import { words } from './support/words';

describe('KbCopyDetectorTest', () => {
  test('fortyConsecutiveWordsAreACopyThirtyNineAreNot', () => {
    const source = 'Intro. ' + words(0, 100) + ' fin.';
    expect(findCopy('Arranque ' + words(10, 39) + ' otra cosa', [source])).toBeNull();
    expect(findCopy('Arranque ' + words(10, 40) + ' otra cosa', [source])).not.toBeNull();
  });

  test('formattingDoesNotHideACopy', () => {
    const source = words(0, 60);
    const page = '**' + words(0, 20).toUpperCase() + '**,\n\n  _' + words(20, 20) + '_ [[file:x|cita]]';
    expect(findCopy(page, [source])).not.toBeNull();
    expect(findCopy(page, [null])).toBeNull();
  });
});
