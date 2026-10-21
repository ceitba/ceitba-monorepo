# Drive / Apuntes: parity of the Bun port

The drive area (`src/features/drive`, `src/external/drive*`) ports `web/drive`, `service/drive`,
`external/drive`, `scheduling/DriveSyncJob` and `config/DriveSync*`. Everything that is HTTP-visible is
checked against the Java jar by `contract/tests/drive-sync.contract.test.ts` (14 tests, green on both
targets; the jar runs with the fake Drive's demo folders and a tiny S3 endpoint,
`test/drive/support/s3mock.ts`). The full `DriveSyncIT` (fake mutations, storage internals, `runAll`) is
`test/drive/DriveSyncIT.test.ts` (in-process). This page lists where byte parity with Java is
measured, where it is not reachable, and why.

## Content fingerprints

`drive_file.content_fingerprint` decides whether a re-fetched file is "changed": a new fingerprint means
a new stored copy, missed deduplication, and an LLM re-digest of the file in the wiki pipeline
(`KbInputs`). Binary files use Drive's `md5Checksum`, so only these depend on the port:

| Kind | Fingerprint | Port |
|---|---|---|
| Docs | `sha("doc\n" + sanitized HTML + assets)` | jsoup 1.21.2 port, byte-identical (below) |
| Slides, Sheets (and Docs too large for HTML) | `sha("pdf\n" + pages + "\n" + PDFTextStripper text)` | pdfjs (unpdf), not always identical (below) |
| Drawings | `sha(PNG bytes)` | identical (bytes) |

### Doc HTML (GoogleDocsHtml + DocHtmlSanitizer)

`src/features/drive/logic/jsoup/` is the spike-4 port: a tiny DOM, jsoup's pretty and compact printers,
`Element.text()`, the Safelist cleaner with `java.net.URL` semantics, and the Docs normalizer. Measured
against 1,834 frozen Java outputs (`test/drive/fixtures/html/goldens`, produced by
`fixtures/html/java/SpikeMain.java` with the real classes; `test/drive/HtmlGoldens.test.ts`):

| Tree builder | Identical | Known diffs | Failures |
|---|---|---|---|
| parse5 (7.3.0 from the workspace store, injected in a scratch run) | 1,832 / 1,834 | 2 (`g07-malformed`) | 0 |
| linkedom (shipped fallback, `parse5` is not a dependency) | 1,832 / 1,834 | 2 (`g07-malformed`) | 0 |

The two known diffs are malformed tag soup (text inside `<tr>`, `&#0;`, `&#xD800;`) that Google never
exports. linkedom is not an HTML5 tree builder; the one rule Google-shaped exports hit (an end tag
`</hN>` closes the open heading: `<h3>..</h2>`) is patched before parsing (`closeHeadings`). Other
HTML5 repairs (foster parenting, misnested formatting, implied end tags beyond that) are not emulated:
on real exports outside the corpus they can give a different tree, hence a different fingerprint.
`parse5` (8.x) is now a dependency of `apps/api`; the builder picks it up by itself
(`import('parse5')` at load) and the golden test then enforces the parse5 result.

The demo Doc of the fake Drive hashes to the same fingerprint on both servers
(`sha:2ae3efbeb5d36e328221c1e9c37849c8`, asserted by the contract test and `ContentPool.test.ts`).

Residuals shared with Java: `unwrapGoogleRedirect` accepts any host ending in `google.com`
(`evilgoogle.com`); lone surrogates hash as `?` in Java and U+FFFD in JS.

### PDF text (Slides/Sheets exports, uploaded PDFs)

`src/features/drive/logic/pdfText.ts` (spike 3): pdfjs text items joined like PDFTextStripper, ligatures
NFKC-expanded, early stop at 1,000,001 chars. Against pdfbox 3.0.5 on the 20 small fixtures in
`test/drive/fixtures/pdf` (`PdfText.test.ts`):

| Measure | Result |
|---|---|
| Failures mapped to `null` (user password, truncated, garbage) | 4 / 4 (+ 1 owner-password file extracts on both) |
| Page counts | 16 / 16 |
| Fingerprint byte-identical | **8 / 16** (50% mismatch on this deliberately hard corpus) |
| Text equal modulo whitespace | 11 / 16 |

Differences: pdfjs drops the space glyph at line ends (pdfkit, MS Word), emits ASCII `-` where pdfbox
emits U+2010 (Chrome `hyphens:auto`), turns a broken Monaco ToUnicode map's "→" into "!", splits rotated
pages differently (pdfbox is the wrong one there), and on old Ghostscript Type1 files pdfbox inserts
spaces. **Known divergence: macOS Pages/Word exports in Calibri** (`real_quartz13_pages_ack.pdf`): pdfjs
garbles the `ti`/`ft` ligatures ("Por%ons", "So1ware") where pdfbox reads them; 92% word match. Font
options do not fix it.

#### When a different fingerprint costs something

Uploaded PDFs are md5-keyed: for them only the search/wiki text differs. A Slides/Sheets export (and a Doc too
large for its HTML export, which falls back to the PDF path) is fingerprinted from its text, and it is re-exported
only when `needsFetch` (`logic/driveSyncRules.ts`) says so. Google-native files have no md5, so that is:

- the first fetch (no fingerprint yet);
- Drive's `modifiedTime` differs from `content_modified_at`: an edit, or a metadata change Drive also stamps
  (a rename, for example);
- the storage mode flipped (source mode, or the size crossed `DRIVE_SYNC_REFERENCE_ABOVE_BYTES`), or the file
  left/entered "download blocked";
- a staff reprocess (`POST /v1/staff/drive/reprocess?kind=SLIDES|SHEET` clears `content_modified_at`).

A new fingerprint then means a new stored copy and, in the wiki pipeline (`KbInputs`), a "changed" input: one LLM
re-digest of the subject. After a real edit that is warranted (Java re-digested too). The exposure is the other
cases: a file whose fingerprint was stored by the Java app (pdfbox) and is re-exported without a text change, where
pdfjs reads it differently.

#### Mitigation (shipped): unchanged extractions keep the stored fingerprint

`DriveContentProcessor.unchangedExtraction`: when a Slides/Sheets re-export's fingerprint matches no stored copy,
its text is compared with the row's stored `text_content` (the extraction that produced the stored fingerprint)
by `sameExtraction` (`logic/pdfText.ts`): equal after NFKC, Unicode hyphens folded to `-` and all whitespace
removed, both texts under the 1,000,000-char cap (a truncated text proves nothing). Equal → the file keeps its
stored fingerprint and copy (`existing`), so no new blob and no re-digest. Same storage mode only; Docs on the PDF
path are not covered (rare, and the Doc HTML path is byte-identical). A real text change still gives a new
fingerprint. Pinned by `test/drive/PdfFingerprintMitigation.test.ts`.

| Corpus (16 fixtures with text or pages) | Fingerprint identical | Kept by the mitigation | Still a new fingerprint |
|---|---|---|---|
| All | 8 | 5 (+ the image-only file, identical anyway) | 3 |
| Chrome/Skia-produced (closest to Google's own exports) | 4 / 5 | 1 / 5 (`chrome_hyphen`) | 0 / 5 |

The three left are producers Google does not use for its exports (CUPS/Quartz, old Ghostscript Type1, macOS
Pages in Calibri). Worst case for one of those: one extra copy and one re-digest, once, the next time Drive
reports a change.

**Decision**: keep pdfjs with the mitigation; no mupdf (AGPL) and no pdfbox sidecar. No human decision is pending.
The pre-cutover gate of `docs/plans/api-bun-spikes.md` §3 (recompute the stored `export.pdf` fingerprints with the
port and count mismatches, now also counting `sameExtraction`) remains the way to measure production's real rate;
only if it shows Google exports diverging beyond what `sameExtraction` absorbs does the sidecar question come back.

## Off the event loop

Doc processing (zip, parse, sanitize, hash) and PDF text extraction run in a Bun Worker pool
(`logic/contentPool.ts` + `contentWorker.ts`): 2 workers by default (`DRIVE_CONTENT_WORKERS`, `0` =
inline), lazily started, `unref()`'d, FIFO queue, a crashed worker is replaced and its job fails like a
Java RuntimeException. Spike numbers: a 470 KB Doc blocks the main thread ~160 ms, ~3 ms gap from a
Worker; a text-heavy PDF peaks at ~350 MB, hence 2 in flight. Results are the same code
(structured-cloned), verified inline and in workers by `ContentPool.test.ts`.

## Other deliberate differences

- **Fake PDFs**: `FakeDriveClient.pdf()` writes its own minimal PDF instead of PDFBox's (whose bytes
  differ on every call: a random `/ID`). Sizes and md5 of the fake's PDFs differ between the two servers;
  their text is the same. Contract tests normalize `sizeBytes`.
- **Streamed downloads (REFERENCE mode)**: Bun sends a `ReadableStream` body chunked and drops
  `Content-Length`; Tomcat keeps it. Files of a known size up to 16 MB are buffered so the header is
  sent; bigger ones stream chunked without it (same bytes, same cap).
- **Doc zip export**: read in memory with a per-entry cap (Java spools to a temp file and reads entries
  with `ZipInputStream`); same entries, same `TooLarge` rule.
- **Requested syncs**: an in-process FIFO (2 running, 500 waiting) instead of a thread pool; same limits.
- **Signed URLs**: `S3ObjectStorage.presignGet` (shared, `src/infra/storage.ts`) builds the ASCII
  fallback of `response-content-disposition` with `[^\x20-\x7e] -> _` and `encodeURIComponent`, Java with
  `[^A-Za-z0-9._ -] -> _` and `URLEncoder` (`+` -> `%20`). They agree for names without `"()'!*~` and
  other ASCII punctuation (all contract cases); reported to the storage owner.
- **Kb hooks**: `hidePagesCiting` / `forgetFiles` (KbModerationService) are SQL in `kbHooks.ts` until
  the kb feature owns them.
