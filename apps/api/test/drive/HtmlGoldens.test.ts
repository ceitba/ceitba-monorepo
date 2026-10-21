// The jsoup port against 1,834 frozen Java outputs (spike 4): Doc content
// fingerprints hash the sanitized HTML, so it must be byte-identical.
// Both tree builders (parse5, and the linkedom fallback used while parse5 is
// not a dependency) give 1,832 identical + the 2 known malformed-markup diffs
// of g07 (docs/DRIVE-PARITY.md); the floor pins that so it cannot regress.
import { describe, expect, test } from 'bun:test';
import { treeBuilder } from '../../src/features/drive/logic/jsoup/jsoup';
import { runGoldens } from './support/htmlGoldens';

/** Identical goldens with the linkedom builder (measured; raise it when the fallback improves). */
const LINKEDOM_FLOOR = 1832;

describe('jsoup port: Java goldens', () => {
  test(`GoogleDocsHtml + DocHtmlSanitizer goldens (${treeBuilder()} tree builder)`, () => {
    const r = runGoldens();
    console.log(`html goldens (${treeBuilder()}): ${r.identical}/${r.total} identical, ${r.known} known parser diffs, ${r.failures.length} failures`);
    expect(r.total).toBe(1834);
    expect(r.failures).toEqual([]);
    expect(r.identical).toBeGreaterThanOrEqual(treeBuilder() === 'parse5' ? 1832 : LINKEDOM_FLOOR);
  });
});
