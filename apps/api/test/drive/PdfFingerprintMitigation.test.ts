// Slides/Sheets fingerprints stored by the Java app were computed from pdfbox's text; pdfjs reads some files
// differently (docs/DRIVE-PARITY.md). A re-export whose text reads the same (sameExtraction) keeps the stored
// fingerprint, so a rename or a staff reprocess does not cost a new copy and a wiki re-digest.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriveClient } from '../../src/external/drive';
import { ContentPool } from '../../src/features/drive/logic/contentPool';
import { cap, pdfInfo, sameExtraction } from '../../src/features/drive/logic/pdfText';
import { DriveContentProcessor, type PreviousContent, type ProcessRequest } from '../../src/features/drive/processor';
import type { DriveSyncProps } from '../../src/features/drive/props';
import { InMemoryObjectStorage } from '../../src/infra/storage';
import { silentLogger } from '../../src/infra/logger';

const DIR = join(import.meta.dir, 'fixtures', 'pdf');
const rows = readFileSync(join(DIR, 'pdfbox.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
const pdfboxText = (name: string) => cap(readFileSync(join(DIR, `${name}.pdfbox.raw.txt`), 'utf8'));
const pdfboxFingerprint = (name: string) => rows.find((r) => r[0] === name)![5]!;

/** Measured: 8 identical + 5 equal modulo whitespace/hyphens/ligatures; 3 still differ. */
const STILL_DIFFERENT = new Set(['quartz_cupsfilter', 'real_ghostscript_rose94', 'real_quartz13_pages_ack']);

describe('sameExtraction', () => {
  test('pdfjs reads the same as pdfbox on 13 of the 16 fixtures', async () => {
    const same: string[] = [];
    const different: string[] = [];
    for (const [name, status] of rows) {
      if (status !== 'OK' || !existsSync(join(DIR, `${name}.pdf`))) continue;
      const fresh = cap((await pdfInfo(new Uint8Array(readFileSync(join(DIR, `${name}.pdf`)))))!.text);
      const stored = pdfboxText(name!);
      if (stored == null && fresh == null) continue; // image-only: same fingerprint anyway
      (sameExtraction(stored, fresh) ? same : different).push(name!);
    }
    expect(different.sort()).toEqual([...STILL_DIFFERENT].sort());
    expect(same.length).toBe(12); // + pdflib_image_only (no text) = 13
  }, 60_000);

  test('a real edit, a missing text or a truncated text is a change', () => {
    expect(sameExtraction('Hola mundo', 'Hola  mundo\n')).toBe(true);
    expect(sameExtraction('Hola mundo', 'Hola mundos')).toBe(false);
    expect(sameExtraction(null, 'x')).toBe(false);
    const long = 'a'.repeat(1_000_000);
    expect(sameExtraction(long, long)).toBe(false);
  });
});

describe('DriveContentProcessor: Slides re-export', () => {
  const NAME = 'pdfkit_plain'; // whitespace-only difference with pdfbox
  const bytes = new Uint8Array(readFileSync(join(DIR, `${NAME}.pdf`)));
  const drive = { export: async () => new Response(bytes).body! } as unknown as DriveClient;
  const props = { maxFileBytes: 50 * 1024 * 1024 } as DriveSyncProps;
  const processor = () => new DriveContentProcessor(drive, new InMemoryObjectStorage(), props, new ContentPool(0), silentLogger);
  const request = (kind: 'SLIDES' | 'DOC', previous: PreviousContent | null, reference = false): ProcessRequest => ({
    fileId: 'f1', driveId: 'd1', kind, name: 'deck', mimeType: 'application/vnd.google-apps.presentation', version: 7,
    knownFingerprint: null, size: null, reference, previous: async () => previous,
  });
  const noCopy = async () => false;

  test('keepsThePdfboxFingerprintWhenTheTextReadsTheSame', async () => {
    const javaFp = pdfboxFingerprint(NAME);
    const c = await processor().process(request('SLIDES', { fingerprint: javaFp, text: pdfboxText(NAME), byReference: false }), noCopy);
    expect(c.existing).toBe(true);
    expect(c.fingerprint).toBe(javaFp);
  });

  test('referenceRowsKeepTheirPrefixedFingerprint', async () => {
    const javaFp = `ref:${pdfboxFingerprint(NAME)}`;
    const c = await processor().process(request('SLIDES', { fingerprint: javaFp, text: pdfboxText(NAME), byReference: true }, true), noCopy);
    expect([c.existing, c.fingerprint]).toEqual([true, javaFp]);
  });

  test('aChangedTextIsANewCopy', async () => {
    const c = await processor().process(request('SLIDES', { fingerprint: 'sha:old', text: 'another deck', byReference: false }), noCopy);
    expect(c.existing).toBe(false);
    expect(c.fingerprint).not.toBe('sha:old');
    expect(c.pdfKey).not.toBeNull();
  });

  test('aStorageModeChangeIsANewCopy', async () => {
    const c = await processor().process(request('SLIDES', { fingerprint: `ref:${pdfboxFingerprint(NAME)}`, text: pdfboxText(NAME), byReference: true }), noCopy);
    expect(c.existing).toBe(false);
  });
});
