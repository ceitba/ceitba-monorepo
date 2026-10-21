// DriveContentProcessor.pdfInfo + cap(), on unpdf (pdfjs) instead of pdfbox
// (spike 3, docs/plans/api-bun-spikes.md; parity numbers in docs/DRIVE-PARITY.md).
//
// Java: Loader.loadPDF + PDFTextStripper().writeText into a CappedWriter of
// MAX_TEXT_CHARS + 1 chars, plus getNumberOfPages(); any IOException or
// RuntimeException -> null. Here a PDFTextStripper-like joiner over pdfjs'
// text items (one "\n" per text line, a "\n" page separator for an empty page,
// presentation forms such as ligatures NFKC-expanded like pdfbox), stopping
// once MAX_TEXT_CHARS + 1 chars are collected (mandatory: an uncapped
// extraction of a text-heavy 45 MB PDF needs 1.4 GB). Every failure
// (PasswordException, InvalidPDFException, ...) -> null, like Java.
//
// Known divergence: pdfjs garbles the Calibri ti/ft ligatures of macOS
// Pages/Word exports ("Por%ons", "So1ware") where pdfbox gets them right, and
// layouts differ on some files, so the Slides/Sheets fingerprint (hashed from
// this text) is not always pdfbox's (docs/DRIVE-PARITY.md).

import { getDocumentProxy } from 'unpdf';
import { javaStrip } from '../../../lib/javaCompat';

export const MAX_TEXT_CHARS = 1_000_000;

export interface PdfInfo { text: string; pages: number }

export async function pdfInfo(bytes: Uint8Array): Promise<PdfInfo | null> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    // pdfjs may transfer/detach the buffer it is given: hand it a copy.
    pdf = await getDocumentProxy(bytes.slice(), { verbosity: 0 });
    const limit = MAX_TEXT_CHARS + 1;
    let out = '';
    for (let p = 1; p <= pdf.numPages && out.length < limit; p++) {
      const page = await pdf.getPage(p);
      const { items } = await page.getTextContent();
      let line = '';
      let lines = 0;
      for (const it of items as { str?: string; hasEOL?: boolean }[]) {
        if (it.str == null) continue;
        line += it.str;
        if (it.hasEOL) {
          out += `${line}\n`;
          line = '';
          lines++;
        }
      }
      if (line) {
        out += `${line}\n`;
        lines++;
      }
      if (lines === 0) out += '\n'; // an empty page still gets PDFTextStripper's page-end separator
      page.cleanup();
    }
    // PDFTextStripper NFKC-normalizes presentation forms (ligatures U+FB00.. etc.).
    out = out.replace(/[ﬀ-﷿ﹰ-﻿]/g, (c) => c.normalize('NFKC'));
    return { text: out.slice(0, limit), pages: pdf.numPages };
  } catch {
    return null;
  } finally {
    await pdf?.loadingTask.destroy().catch(() => {});
  }
}

/** DriveContentProcessor.cap: no NULs, Java strip(), empty -> null, at most MAX_TEXT_CHARS. */
export function cap(text: string | null | undefined): string | null {
  if (text == null) return null;
  const t = javaStrip(text.replaceAll('\u0000', ''));
  if (t.length === 0) return null;
  return t.length <= MAX_TEXT_CHARS ? t : t.slice(0, MAX_TEXT_CHARS);
}
