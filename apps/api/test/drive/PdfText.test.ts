// PDF text (DriveContentProcessor.pdfInfo + cap) on unpdf/pdfjs against pdfbox
// 3.0.5 outputs (spike 3): test/drive/fixtures/pdf/<name>.pdf with
// <name>.pdfbox.raw.txt (PDFTextStripper output) and pdfbox.tsv (status,
// pages, the Slides/Sheets fingerprint sha("pdf\n"+pages+"\n"+text)), produced
// by fixtures/pdf/PdfboxExtract.java. Uploaded PDFs are md5-keyed, so their
// text only feeds search; Slides/Sheets exports hash it. Measured parity is in
// docs/DRIVE-PARITY.md and pinned below.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cap, pdfInfo } from '../../src/features/drive/logic/pdfText';

const DIR = join(import.meta.dir, 'fixtures', 'pdf');
const rows = readFileSync(join(DIR, 'pdfbox.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
const fp = (pages: number, text: string) => `sha:${createHash('sha256').update(`pdf\n${pages}\n${text}`, 'utf8').digest('hex').slice(0, 32)}`;
const ws = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Fixtures whose fingerprint matches pdfbox byte for byte (measured; see docs/DRIVE-PARITY.md). */
const FINGERPRINT_EQUAL = new Set(['chrome_columns', 'chrome_ligatures', 'chrome_slides', 'chrome_table', 'pdfbox_encrypted_owner',
  'pdfbox_multipage25', 'pdflib_image_only', 'real_quartz_rbash']);
/** Text equal modulo whitespace (pdfjs drops the space glyph at line ends on these producers). */
const WHITESPACE_EQUAL = new Set(['pdfkit_plain', 'pdfkit_encrypted_owner_aes128', 'real_word_license']);

describe('PDF text: unpdf vs pdfbox', () => {
  test('null mapping, page counts, text and fingerprints', async () => {
    let exact = 0;
    let wsEqual = 0;
    let ok = 0;
    const report: string[] = [];
    for (const [name, status, pages] of rows) {
      const file = join(DIR, `${name}.pdf`);
      if (!existsSync(file)) continue;
      const info = await pdfInfo(new Uint8Array(readFileSync(file)));
      if (status !== 'OK') {
        expect([name, info]).toEqual([name!, null]);
        continue;
      }
      ok++;
      expect([name, info?.pages]).toEqual([name!, Number(pages)]);
      const java = readFileSync(join(DIR, `${name}.pdfbox.raw.txt`), 'utf8');
      const same = fp(info!.pages, info!.text) === rows.find((r) => r[0] === name)![5];
      if (same) exact++;
      if (ws(cap(info!.text)) === ws(cap(java))) wsEqual++;
      report.push(`${name}: ${same ? 'fingerprint equal' : ws(cap(info!.text)) === ws(cap(java)) ? 'whitespace-equal' : 'differs'}`);
      if (FINGERPRINT_EQUAL.has(name!)) expect([name, info!.text]).toEqual([name!, java]);
      if (WHITESPACE_EQUAL.has(name!)) expect([name, ws(cap(info!.text))]).toEqual([name!, ws(cap(java))]);
    }
    console.log(`pdf text: ${exact}/${ok} fingerprint-equal, ${wsEqual}/${ok} whitespace-equal\n  ${report.join('\n  ')}`);
    expect(exact).toBeGreaterThanOrEqual(FINGERPRINT_EQUAL.size);
  }, 60_000);

  test('Calibri ligatures (macOS Pages export): known pdfjs divergence', async () => {
    const info = await pdfInfo(new Uint8Array(readFileSync(join(DIR, 'real_quartz13_pages_ack.pdf'))));
    const java = readFileSync(join(DIR, 'real_quartz13_pages_ack.pdfbox.raw.txt'), 'utf8');
    expect(info!.pages).toBe(7);
    expect(info!.text).not.toBe(java);
  });

  test('cap: NULs dropped, Java strip, blank -> null', () => {
    expect(cap(' \u0000\n a b  ')).toBe('a b');
    expect(cap('\n\n')).toBeNull();
    expect(cap(' x ')).toBe(' x ');
    expect(cap(null)).toBeNull();
  });
});
