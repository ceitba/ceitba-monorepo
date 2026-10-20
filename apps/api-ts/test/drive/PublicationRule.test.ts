// Port of apps/api/src/test/java/org/ceitba/api/service/drive/PublicationRuleTest.java
import { describe, expect, test } from 'bun:test';
import { decidePublication as decide, type PublicationInput } from '../../src/features/drive/logic/publicationRule';

// A file that is published under the plain rule.
const base = (): PublicationInput => ({
  kind: 'PDF', removedFromDrive: false, staffDecision: null, hasEffectiveSubject: true, effectivelyHidden: false,
  sourceLive: true, sourceApproved: true, ownedBySharer: true, reportCount: 0,
});

const FIELDS = {
  kind: 'kind', removed: 'removedFromDrive', decision: 'staffDecision', subject: 'hasEffectiveSubject',
  hidden: 'effectivelyHidden', live: 'sourceLive', approved: 'sourceApproved', owned: 'ownedBySharer',
  reports: 'reportCount',
} as const;
const withField = (b: PublicationInput, field: keyof typeof FIELDS, v: unknown): PublicationInput =>
  ({ ...b, [FIELDS[field]]: v });

describe('PublicationRuleTest', () => {
  test('ownFileWithSubjectInApprovedSourceIsPublished', () => {
    expect(decide(base())).toBe('PUBLISHED');
  });

  test('foldersAreNeverPublished', () => {
    expect(decide(withField(base(), 'kind', 'FOLDER'))).toBe('PRIVATE');
  });

  test('privateWithoutSubjectOrWhenHiddenOrSourceDown', () => {
    expect(decide(withField(base(), 'subject', false))).toBe('PRIVATE');
    expect(decide(withField(base(), 'hidden', true))).toBe('PRIVATE');
    expect(decide(withField(base(), 'live', false))).toBe('PRIVATE');
  });

  test('needsReviewWhenOwnedByOthersOrSourcePending', () => {
    expect(decide(withField(base(), 'owned', false))).toBe('NEEDS_REVIEW');
    expect(decide(withField(base(), 'approved', false))).toBe('NEEDS_REVIEW');
  });

  test('reportsHidePublishedFilesAtThree', () => {
    expect(decide(withField(base(), 'reports', 2))).toBe('PUBLISHED');
    expect(decide(withField(base(), 'reports', 3))).toBe('HIDDEN_REPORTED');
    // Reports do not move a file that is not published anyway.
    expect(decide(withField(withField(base(), 'owned', false), 'reports', 5))).toBe('NEEDS_REVIEW');
  });

  test('staffDecisionsStick', () => {
    const published = withField(base(), 'decision', 'PUBLISH');
    expect(decide(withField(published, 'owned', false))).toBe('PUBLISHED');
    expect(decide(withField(published, 'approved', false))).toBe('PUBLISHED');
    expect(decide(withField(published, 'reports', 9))).toBe('PUBLISHED');
    // ...but never past the student's own choices or a dead source.
    expect(decide(withField(published, 'hidden', true))).toBe('PRIVATE');
    expect(decide(withField(published, 'live', false))).toBe('PRIVATE');

    const removed = withField(base(), 'decision', 'REMOVE');
    expect(decide(removed)).toBe('REMOVED_BY_STAFF');
    expect(decide(withField(removed, 'subject', false))).toBe('REMOVED_BY_STAFF');
  });

  test('goneFromDriveWins', () => {
    expect(decide(withField(withField(base(), 'decision', 'PUBLISH'), 'removed', true))).toBe('REMOVED');
  });
});
