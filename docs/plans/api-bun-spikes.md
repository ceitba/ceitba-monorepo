# API on Bun: phase 2 dependency spikes

Results of the dependency spikes in `docs/plans/api-bun-rewrite.md` §"Phase 2: dependency spikes", run on
2026-10-20. No real credentials were used. Everything ran against emulators, local containers and local mocks,
with the repo's fixtures. The plan's pass conditions name real credentials ("sends an FCM push", "a real Apuntes
folder", "20 real Apuntes PDFs"). Those runs are still pending; see "Still to verify with real credentials".

The spike scripts were throwaway and are not in the repo. What the port needed was kept as code or fixtures:

| Spike output | Where it is now |
|---|---|
| `html/jsoupish.ts`, `html/pipeline.ts` (the jsoup port) | ported into `apps/api/src/features/drive/logic/jsoup/` |
| `html/goldens/` (1,834 Java outputs) | `apps/api/test/drive/fixtures/html/goldens/{corpus,gdocs,links}.jsonl` (`test/drive/HtmlGoldens.test.ts`) |
| `html/corpus/` | `apps/api/test/drive/fixtures/html/corpus/` |
| `html/java/…/SpikeMain.java` (the Java oracle) | `apps/api/test/drive/fixtures/html/java/SpikeMain.java` |
| `pdf/pdfText.ts`, `pdf/extract.ts` (`javaStrip`) | `apps/api/src/features/drive/logic/pdfText.ts`, `src/lib/javaCompat.ts` |
| `pdf/pdfs/` + `pdf/java/PdfboxExtract.java` | `apps/api/test/drive/fixtures/pdf/` (20 PDFs with their pdfbox outputs, `pdfbox.tsv`, `PdfboxExtract.java`; `test/drive/PdfText.test.ts`) |

Not kept: the two large PDF fixtures (`pdfbox_large_images.pdf`, `pdfbox_large_text.pdf`, ~45 MB each, used only for the memory and
blocking measurements of §3, whose numbers are below), the mupdf comparison scripts, and the scripts of the other
spikes (firebase-admin, Drive, pgvector, nodemailer, S3, runtime). Their findings are this report and the code they
led to; rerunning one means rewriting its script from the snippets below.

**Environment**: Bun 1.4.0 (reports itself to libraries as `gl-node/26.3.0`), Node 26.4.0 (used only for
mocks and the Node comparison), Temurin JDK 21.0.12, Docker 29.2, macOS (arm64). The Java side ran the real
classes from `apps/api/target/classes` with the Maven runtime classpath.

## Verdicts

| # | Spike | Verdict | Changes the plan? |
|---|---|---|---|
| 1 | firebase-admin (FCM + Firestore) on Bun | **PASS** | No. Firestore is not an API dependency at all (see 1b) |
| 2 | Drive v3 (`@googleapis/drive`) on Bun | **PASS-with-caveats** | Port the retry policy by hand; use `@googleapis/drive`, not `googleapis` |
| 3 | PDF text extraction (`unpdf`/pdfjs) | **PASS-with-caveats** | Yes: the Slides/Sheets fingerprint needs byte parity, and pdfjs garbles Calibri ligatures. Decide between a cutover gate, mupdf (AGPL) and a pdfbox sidecar |
| 4 | HTML sanitizing (jsoup) | **PASS-with-caveats** | Yes: off-the-shelf libraries fail. Budget a custom parse5 cleaner and a jsoup-style serializer (~580 lines) plus the Java goldens |
| 5 | pgvector via `postgres` | **PASS** | No. Same top-k and bit-identical distances as JDBC |
| 6 | SMTP / Gmail MIME via nodemailer | **PASS-with-caveats** | No. The MIME tree is simpler (alternative only); the decoded content is equal |
| 7 | S3 presign vs MinIO | **PASS-with-caveats** | No. It needs `signableHeaders` + `WHEN_REQUIRED`, and `Bun.S3Client.presign` is unusable for uploads |
| 8 | Bun runtime basics | **PASS** | Minor: job locks use one short-lived client per run, not `sql.reserve()` |

---

## 1. firebase-admin on Bun

**Verdict: PASS.** FCM `sendEachForMulticast` works on Bun over both transports, the HTTP/2 default and
`enableLegacyHttpTransport()`. The request body is the same JSON as Java's, and per-token errors map to the same
outcomes. Firestore over gRPC also works on Bun against the emulator, and so does REST (`preferRest`).

Versions: `firebase-admin@14.5.0` (Java: `firebase-admin` 9.11.0), `@google-cloud/firestore@9.3.1`,
`@grpc/grpc-js@1.14.6`, `google-auth-library@11.3.1`. Emulator:
`gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators`.

### 1a. FCM

Setup:
- **Mock.** A Node `http2.createSecureServer({ allowHTTP1: true })` with a self-signed certificate answers the
  way `FirebasePushGatewayTest.fakeFcm` does: tokens named `dead-*` get UNREGISTERED, `bad-*` get
  INVALID_ARGUMENT, `busy-*` get QUOTA_EXCEEDED, and every other token succeeds.
- **Redirect.** On the Bun side, `http2.connect` and `https.request` were patched to send everything to
  `127.0.0.1`, and `globalThis.fetch` refused any non-local host.
- **Java body.** Captured by running the real `FirebasePushGateway.toMulticast` through `FirebaseMessaging` on a
  `MockHttpTransport`.

Results:
- **Body.** One POST per token to `/v1/projects/demo-ceitba/messages:send`. The body is semantically equal to
  Java's (`json.loads` equality). Only the key order differs:

  ```json
  {"message":{"notification":{"title":"CEITBA","body":"Hola"},"data":{"type":"article","id":"a1"},
   "android":{"priority":"high"},"apns":{"payload":{"aps":{"sound":"default","content-available":1}}},
   "token":"ok-1"}}
  ```

- **Outcomes.** `ok-1, dead-1, bad-1, busy-1, ok-2` gave `SENT, UNREGISTERED, INVALID_ARGUMENT, FAILED, SENT`,
  the same as `sendsThroughFirebaseMessagingAndMapsPerTokenErrors`. The error codes were
  `messaging/registration-token-not-registered`, `messaging/invalid-argument` and
  `messaging/message-rate-exceeded`.
- **`cert()` credential.** It parses a service-account JSON on Bun. Its RS256 JWT grant (`jwt-bearer`, scopes
  include `firebase.messaging`) was minted and posted correctly. The access token it got back from the mock was
  then used as `Bearer` on the FCM calls.

Working approach:

```ts
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

const app = initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) }, 'ceitba-push');
const messaging = getMessaging(app);

const toMulticast = (tokens: string[], m: PushMessage) => ({
  tokens,
  notification: { title: m.title, body: m.body },
  data: m.data,                                    // values must be strings
  android: { priority: 'high' as const },
  apns: { payload: { aps: { sound: 'default', contentAvailable: true } } },
});

const outcome = (r: SendResponse) =>
  r.success ? 'SENT'
  : r.error?.code === 'messaging/registration-token-not-registered' ? 'UNREGISTERED'
  : r.error?.code === 'messaging/invalid-argument' ? 'INVALID_ARGUMENT'
  : 'FAILED';

const res = await messaging.sendEachForMulticast(toMulticast(tokens, msg)); // ≤ 500 tokens
await app.delete();                                                         // on shutdown
```

Gotchas:
- **Only the legacy transport was tested unmodified.** The HTTP/2 run (the default) passed only because the
  harness rewrote `:scheme` (next point). The legacy HTTP/1.1 transport is the path verified with no change to
  the request. Google's front end has served firebase-admin's HTTP/2 client in production for years, so the
  verdict stays PASS. Still, the first real push must use the default transport as shipped, with
  `enableLegacyHttpTransport()` as the verified fallback.
- **Token endpoint.** `google-auth-library` ignores the key's `token_uri` and always posts to
  `https://oauth2.googleapis.com/token`. Tests must stub `fetch` or inject a credential object
  (`{ getAccessToken: async () => ({ access_token, expires_in }) }`), the way the Java test uses
  `GoogleCredentials.create(AccessToken)`. *During the spike this caused one request to Google:* a JWT grant
  signed with a locally generated key, which Google rejected ("account not found"). No real credential was
  involved, and every run after that went through a fetch guard.
- **`:scheme` header.** firebase-admin's HTTP/2 client sends `:scheme: "https:"`, the URL protocol with its
  colon. Google's front end accepts it, but nghttp2-based servers, including a Node mock, reset the stream with
  `NGHTTP2_PROTOCOL_ERROR`. A local HTTP/2 mock has to rewrite the header. The bug is not in Bun: Node's client
  fails the same way against the same mock.
- **Concurrency.** `sendEachForMulticast` opens one HTTP/2 session and sends every token concurrently. Java
  sends them through a thread pool. The outcome is the same.
- **Install size.** firebase-admin pulls `@google-cloud/firestore` and `@google-cloud/storage` as optional
  dependencies (about 18 MB). The image can skip them, as the pom does: only `firebase-admin/app` and
  `firebase-admin/messaging` are imported.

**Fallback (not needed):** call FCM HTTP v1 directly with `fetch`, using a `google-auth-library` JWT and one
POST per token. That is about 40 lines and would remove the dependency.

### 1b. Firestore

**The API never talks to Firestore.** The pom excludes `google-cloud-firestore`.
`service/sync/FirestoreImportService` consumes the JSON document that `apps/api/scripts/firestore-export/export.mjs`
produces, which a person runs once on Node and POSTs to `/v1/sync/import/firestore`. The rewrite therefore needs
no Firestore client at all: the import is a JSON endpoint. The spike still checked that the one-off tool works on
Bun:

1. **Seed.** The emulator ran on port 58085. `apps/api/src/test/resources/fixtures/firestore-export.json` was
   written into `Usuarios` / `Propuestas` / `Benefits` (the capitalized names that `export.mjs` reads), plus a
   document with a `Timestamp`, a `GeoPoint`, a `DocumentReference` and nested values. The writes went through
   firebase-admin on Bun, over gRPC (12 docs, about 0.5 s) and again with `settings({ preferRest: true })`
   (about 0.3 s).
2. **Export.** An unmodified copy of `export.mjs` ran under `bun` and under `node`. The two outputs are
   **byte-identical**. Every fixture document round-trips equal, minus `fcmTokens`, which the script drops on
   purpose. Timestamps come out as ISO-8601 strings, the GeoPoint as `{latitude, longitude}` and the reference
   as its path.

## 2. Google Drive v3 on Bun

**Verdict: PASS-with-caveats.**
- **What works.** `@googleapis/drive` on Bun builds the same `files.list`, `files.get` and `files.export`
  requests as `external/drive/GoogleDriveClient`. Pagination, field selection, shortcut details and UTF-8 names
  all behave the same, and `responseType: 'stream'` really streams.
- **Caveats.** Java's retry policy has to be ported by hand. The media URL differs, but in a way the real API
  accepts both.

Versions: `@googleapis/drive@26.0.2` (`googleapis-common@9.3.1`, `gaxios@8.3.1`); Java:
`google-api-services-drive` v3-rev20260428-2.0.0. Use `@googleapis/drive` rather than the full `googleapis`
package: it is the same generated code at a fraction of the install size.

Setup:
- **Mock.** One local HTTP server (`Bun.serve`) acted as both Drive and the token endpoint, and logged method,
  path and sorted query.
- **Java.** It ran the **real** `GoogleDriveClient` methods (`listChildren`, `listSharedFolders`, `getFile`,
  `download`, `export`). Its private `drive` field was swapped by reflection for a `Drive` built with
  `setRootUrl("http://127.0.0.1:58200/")` and a static bearer token.
- **Bun.** It used a `google-auth-library` JWT with the drive.readonly scope (token request redirected to the
  mock), and `rootUrl` pointed at the mock.

Results (Java and Bun, 9 calls each):

| Call | Equal? | Notes |
|---|---|---|
| `files.list` ×3 pages (children) + ×3 (shared folders) | **same** path and query | `q` escaping (`'fold\'er\\x' in parents and trashed=false`), `fields=nextPageToken,files(...)`, `pageSize=1000`, `supportsAllDrives`, `includeItemsFromAllDrives`, `pageToken` |
| `files.get` metadata | **same** | |
| download | differs, harmless | Java uses `/download/drive/v3/files/{id}?alt=media&supportsAllDrives=true`, Node `/drive/v3/files/{id}?alt=media&supportsAllDrives=true`. Drive serves both |
| export | differs, harmless | Java uses `/download/drive/v3/files/{id}/export?alt=media&mimeType=text/html`, Node `/drive/v3/files/{id}/export?mimeType=text/html` |

Streaming: an 8 MB `alt=media` download arrived as a Node `Readable`, with the first chunk after 5 ms of a 12 ms
total. It does not buffer, so large Apuntes files can be piped to a temp file or to S3.

Working approach:

```ts
import { drive_v3, auth } from '@googleapis/drive';

const key = JSON.parse(decodeKey(env.DRIVE_SYNC_SERVICE_ACCOUNT_JSON));   // raw JSON or base64, like Java
const jwt = new auth.JWT({ email: key.client_email, key: key.private_key,
                           scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
const drive = new drive_v3.Drive({ auth: jwt, timeout: 120_000, retry: false } as any);

const FIELDS = 'id,name,mimeType,parents,owners(emailAddress),createdTime,modifiedTime,md5Checksum,version,'
             + 'size,shortcutDetails(targetId,targetMimeType)';
const esc = (s: string) => s.replaceAll('\\', '\\\\').replaceAll("'", "\\'");

async function listChildren(folderId: string) {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await withRetry('list', () => drive.files.list({
      q: `'${esc(folderId)}' in parents and trashed=false`,
      fields: `nextPageToken,files(${FIELDS})`, pageSize: 1000,
      supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken }));
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

const download = (id: string) => withRetry('download', () =>
  drive.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' }));
const exportAs = (id: string, mimeType: string) => withRetry('export', () =>
  drive.files.export({ fileId: id, mimeType }, { responseType: 'stream' }));
```

Gotchas:
- **Default retries differ from Java.** By default gaxios retries a 429 three times on its own (4 hits, about
  2 s, in the spike), and it does not retry a 403 `rateLimitExceeded` / `userRateLimitExceeded`. Java retries 429,
  403 rate-limit reasons, 5xx and I/O errors, with 4 attempts at 1 s / 2 s / 4 s plus up to 250 ms of jitter.
  Set `retry: false` and port `withRetry` and `translate` by hand. On errors, `e.status` carries the HTTP status
  and `e.errors[0].reason` the reason (for example `rateLimitExceeded`), which is enough to port
  `DriveApiException`.
- **Token endpoint.** Again, `google-auth-library` posts to `oauth2.googleapis.com/token` regardless of
  `token_uri`, so tests need a stubbed `fetch` or a pre-set credential.
- **Timestamps.** `modifiedTime` / `createdTime` arrive as RFC 3339 strings. Java parses them to `Instant`
  (`2024-03-01T10:00:00Z` when it prints the record), so parse them explicitly.
- **`size`.** It is a decimal **string** in JSON. Java's model makes it a `Long`; keep it a string or use
  `BigInt`, and never put it through `Number` arithmetic unchecked.

**Fallback:** plain `fetch` against `https://www.googleapis.com/drive/v3/files`. Only three endpoints are used,
and the JWT can still come from `google-auth-library`.

## 3. PDF text extraction

**Verdict: PASS-with-caveats.** The fallback needs a decision.
- **Parity.** `unpdf` (pdfjs) on Bun, with a small PDFTextStripper-style joiner, gives **byte-identical** text to
  pdfbox on 11 of 17 parseable fixtures, and whitespace-equal text on 3 more. Page counts match on all of them.
- **Errors and memory.** Every failure case maps to `null` the same way Java does. With an early stop at
  1,000,001 chars it uses less memory and time than Java.
- **Open issue.** pdfjs garbles the Calibri `ti`/`ft` ligatures in macOS Pages/Word exports ("Por%ons",
  "So1ware"), where pdfbox gets them right.

Versions: `unpdf@1.9.1` (bundles pdfjs 6.4.299), `pdfjs-dist@6.4.299`. Java: pdfbox 3.0.5. Fallback tested:
`mupdf@1.28.1` (WASM, **AGPL-3.0**).

### What Java does

`DriveContentProcessor.pdfInfo` loads the file with
`Loader.loadPDF(file, IOUtils.createTempFileOnlyStreamCache())`. It writes the default
`PDFTextStripper().writeText` output into a `CappedWriter(MAX_TEXT_CHARS + 1)` and reads `getNumberOfPages()`.
Any `IOException` or `RuntimeException` returns `null`. `cap()` then:
- removes `\u0000`;
- applies Java `strip()`, which uses Java's whitespace definition and **not** JS `trim()`;
- turns an empty result into `null`;
- truncates to 1,000,000 chars.

The result goes to `drive_file.text_content`, which feeds search and the KB pipeline.

### Does the output need to be byte-identical? It depends on the file type

- **Uploaded PDFs.** The fingerprint is Drive's `md5:<md5Checksum>` (`DriveItem.binaryFingerprint`,
  `DriveSyncStore.needsFetch`). The extracted text never affects change detection, so **whitespace-equal is
  enough**, and existing rows are not re-extracted at cutover.
- **Slides/Sheets** (and Docs too large for HTML) go through `pdfExport()`:
  - The fingerprint is `"sha:" + sha256("pdf\n" + pages + "\n" + rawStripperText)[0:16]`, computed on the
    **raw** text before `cap()`.
  - The KB treats a changed fingerprint as a changed file (`service/kb/pipeline/KbInputs.java` ~l.115). It reuses
    digests by `(content_fingerprint, PROMPT_VERSION)` (`KbFileDigestRepository.findByContentFingerprintInAndPromptVersion`,
    `KbPipelineService` ~l.289/770).
  - So **byte-identity matters here**: a mismatch costs one LLM re-digest per affected file.
  - The exposure is bounded. A fingerprint is only recomputed when the file is re-fetched (its `modifiedTime`
    moves, a rename counts, or its storage mode, export-blocked state or version changes), not for every file at
    cutover. Blob deduplication (`findContentHolders`) also misses between old and new fingerprints until the
    rows converge.
- **Cutover gate (recommended).** For non-reference SLIDES/SHEET rows with a stored `export.pdf`, recompute the
  fingerprint with the Bun port and compare it to `content_fingerprint`. That measures the real mismatch rate
  before switching.

### Results (Bun port vs a pdfbox mirror of `pdfInfo` + `cap()`)

| Fixture (producer) | Pages | Exact / fingerprint | Whitespace-normalized | Note |
|---|---|---|---|---|
| Chrome: ligatures (serif fi/fl, literal U+FB01), 2 columns, table, 16:9 positioned "slides" | 1–2 | **same** | same | Both expand ligatures; same reading order |
| Chrome `hyphens:auto` | 1 | differs | differs | pdfbox emits U+2010, pdfjs ASCII `-` |
| pdfbox: 25 pages with accents and ñ; 45 MB / 42 images; 45 MB / 5,000 pages / 21M chars | 25–5000 | **same** | same | Cap boundary identical |
| Encrypted, owner password only (AES-256 pdfbox, AES-128 pdfkit) | 1 | same / differs | same | Both ignore the permissions and extract |
| pdfkit plain; real MS Word | 1–5 | differs | **same** | pdfjs drops the space glyph at line end |
| Real Quartz (1999) | 1 | same | same | |
| Image only, no text layer | 2 | same | same | Both `"\n\n"`, so `cap()` gives `null` |
| `/Rotate` 0/90/270 | 3 | differs | differs | **pdfbox** splits rotated text into fragments; pdfjs is correct |
| Ghostscript 6.5 Type1 | 13 | differs | differs | **pdfbox** inserts spaces ("ev al"); 99.8% word match |
| Quartz, Monaco font with a broken ToUnicode map | 1 | differs | differs | pdfjs turns "→" into "!" |
| **Pages/Quartz, Calibri** | 7 | differs | differs | **pdfjs: "Por%ons", "So1ware"**; 92.3% word match |
| User password ×2, truncated, garbage | – | both `null` | – | |

`unpdf`'s `extractText(pdf, { mergePages: true })` collapses whitespace and drops page-end newlines, so it
breaks the fingerprint. Use the per-page loop below. Font options (`standardFontDataUrl`, `useSystemFonts`,
cMaps) do not fix the Calibri case.

Error mapping:

| Case | Java | Bun | Mapping |
|---|---|---|---|
| User password | `InvalidPasswordException` | `PasswordException` | `null` |
| Truncated / garbage | `IOException` | `InvalidPDFException` | `null` |
| Owner password only | extracts | extracts | same |

Memory and time (`/usr/bin/time -l`):

| File | pdfbox (temp-file cache) | unpdf `mergePages`, uncapped | Bun port with early stop |
|---|---|---|---|
| 45 MB image-heavy | 0.24 s, 121 MB | 0.05 s, 111 MB | 0.05 s, 113 MB |
| 45 MB text-heavy | 5.4 s, 516 MB | 2.7 s, **1.42 GB** | 0.21 s, 343 MB |

Bun holds the whole file buffer, which is fine at the 50 MB `DRIVE_SYNC_MAX_FILE_BYTES`. The uncapped call is
**unsafe** in a 2 GB container. The early stop is mandatory, and it is output-identical, because Java keeps only
the first 1,000,001 chars anyway. pdfjs did not stall the event loop (the longest gap was 6–8 ms), so a
`Worker` is optional and only helps throughput.

### Working approach

```ts
import { getDocumentProxy } from 'unpdf';
const MAX_TEXT_CHARS = 1_000_000;

export async function pdfInfo(bytes: Uint8Array): Promise<{ text: string; pages: number } | null> {
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes, { verbosity: 0 });
    const limit = MAX_TEXT_CHARS + 1;                         // = CappedWriter(MAX_TEXT_CHARS + 1)
    let out = '';
    for (let p = 1; p <= pdf.numPages && out.length < limit; p++) {   // early stop: mandatory
      const page = await pdf.getPage(p);
      const { items } = await page.getTextContent();
      let line = '', lines = 0;
      for (const it of items as any[]) {
        if (it.str == null) continue;
        line += it.str;
        if (it.hasEOL) { out += line + '\n'; line = ''; lines++; }
      }
      if (line) { out += line + '\n'; lines++; }
      if (lines === 0) out += '\n';                           // PDFTextStripper page separator
      page.cleanup();
    }
    out = out.replace(/[ﬀ-﷿ﹰ-﻿]/g, (c) => c.normalize('NFKC')); // ligatures, like pdfbox
    return { text: out.slice(0, limit), pages: pdf.numPages };
  } catch {
    return null;                                              // PasswordException, InvalidPDFException, ...
  } finally {
    await pdf?.loadingTask.destroy().catch(() => {});         // pdfjs 6: no PDFDocumentProxy.destroy()
  }
}
```

`cap()` must use Java `strip()` semantics. Java's whitespace set is the Zs/Zl/Zp categories except U+00A0,
U+2007 and U+202F, plus `\t \n \v \f \r` and U+001C–U+001F. The spike's port is `javaStrip` in the scripts.

Gotchas:
- Under Bun, pdfjs warns that it cannot load standard font data. Text output is unaffected.
- If the 1,000,001-char cut splits a surrogate pair, the fingerprint differs: Java's UTF-8 encoder writes `?`,
  JS writes U+FFFD. This is an edge case.
- There is no exact parity in either direction. pdfjs is *better* than pdfbox on rotated pages and old Type1
  files, and worse on Calibri ligatures and broken ToUnicode maps.

### Fallback

- **`mupdf` (WASM).** It is whitespace-equal to pdfbox where pdfjs fails (Calibri, Monaco, U+2010), and it handles
  rotated pages (0.28 s, 360 MB on the 45 MB text file).
  - It is **not** fingerprint-compatible, because block layout differs.
  - A truncated file gives 0 pages instead of an exception, so map `pages === 0` to `null`.
  - It is **AGPL-3.0**, which needs a licence decision for a network service.
- **pdfbox sidecar.** A small JVM helper for PDF text only. It is the only way to keep the Slides/Sheets
  fingerprint byte-identical.
- **Suggested path.**
  1. Use the pdfjs port for uploaded PDFs, which are md5-keyed.
  2. Run the cutover gate on Slides/Sheets.
  3. If the mismatch rate or the Calibri damage is unacceptable, choose between mupdf (licence sign-off) and
     the pdfbox sidecar.

## 4. HTML sanitizing (jsoup)

**Verdict: PASS-with-caveats.**
- **What works.** parse5 plus about 580 lines of custom TS (a jsoup-style cleaner and a serializer that emulates
  jsoup 1.21.2's printer) gives **byte-identical** output to `GoogleDocsHtml.normalize` +
  `DocHtmlSanitizer.sanitize` on every hand-built export in Google's style. Real exports are still pending. Byte-identical output means an
  identical `content_fingerprint`.
- **What fails.** The off-the-shelf libraries (linkedom or cheerio, with sanitize-html) fail byte parity on every
  non-empty document, and fail even semantic equality on half of them.
- **Residual risk.** jsoup's pretty-print rules were reverse-engineered from its behaviour and pinned by Java
  goldens, not read from source. Malformed tag soup, which Google never exports, still differs at the parser
  level. On that input the output is equally safe, but not byte-equal.

Versions: `parse5@8.0.1`, `linkedom@0.18.13`, `sanitize-html@2.18.1`, `cheerio@1.2.0`, `htmlparser2@12.0.0`. The
oracle was the real `GoogleDocsHtml` / `DocHtmlSanitizer` classes with jsoup 1.21.2.

### What Java does, and why byte identity matters

- **`GoogleDocsHtml.normalize`.**
  - Parses the export with `Jsoup.parse` and reads the `<style>` CSS with a regex.
  - Wraps formatting in `<strong>`, `<em>`, `<u>`, `<s>`, `<sup>` or `<sub>`, and sets `data-align`.
  - Nests the flat `lst-kix_*-N` lists, with `ol type`/`start`.
  - Wraps paragraphs with a margin-left of 36pt or more in `<blockquote>`.
  - Returns `doc.outerHtml()`, with **default OutputSettings, so prettyPrint is on**.
- **`DocHtmlSanitizer.sanitize`.**
  1. Rewrites `img src` to a placeholder (via `URLDecoder`), or removes the image.
  2. Unwraps `google.com/url?q=` links.
  3. Serializes with `body().html()`, which **pretty-prints again**.
  4. Cleans with `Jsoup.clean`. The Safelist is `relaxed()` plus `s` and `data-align`, with `rel` and `target`
     enforced on `a` and prettyPrint off.
  5. Re-parses the fragment, keeps only placeholder images and returns compact `body().html()` plus
     `body().text()`.
- **Both pretty passes leave whitespace text nodes in the stored HTML**, so a port must reproduce jsoup's printer.
  A compact serializer is not enough.
- **The fingerprint.** `DriveContentProcessor.parseDoc` (~l.254) computes `content_fingerprint` as
  `sha256("doc\n" + html + per asset "\n"+name+"\n"+bytes)`.
  - Docs have no md5. `DriveSyncStore.needsFetch` re-exports them only when `modifiedAt` moves (edits and renames)
    or the storage mode changes, or after a staff reprocess (`clearContentModifiedAtForReprocess`).
  - A changed fingerprint means a new storage copy and missed dedup. `KbInputs` then marks the file changed, which
    triggers an LLM DIGEST, then PLAN and WRITE for the subject.
  - So **non-identical output costs LLM spend on every rename, and a staff reprocess would re-run the KB for every
    subject.** That is why byte parity is the bar here.

### Corpus and results

- **Corpus.** 17 files:
  - t01–t05: every input from `GoogleDocsHtmlTest` and `DocHtmlSanitizerTest`, including the real fixture;
  - g01–g10: hand-built exports in the real Google style (headings with `h.*` ids, `&nbsp;`, emoji, accents,
    RTL/CJK, nested and continued lists, tables without tbody, redirect links, `#cmnt`/`#ftnt`, `javascript:` /
    `data:`, googleusercontent images, hostile markup, malformed input, whitespace-heavy sources);
  - g11: empty; g12: a bare fragment.
- **Generated cases.** 4,300 Google-shaped documents, 11,500 hrefs and srcs, and 2,000 tag-soup documents, all
  checked live against the Java oracle.

| Approach | Pipeline HTML bytes (= fingerprint) | Semantic | `text()` | Sanitize-only bytes | 4,300 generated Google-shaped docs |
|---|---|---|---|---|---|
| (a) linkedom + sanitize-html | 1/17 (empty only) | 9/17 | 2/17 | 1/17 | – |
| (c) cheerio/htmlparser2 + sanitize-html | 1/17 | 13/17 | 14/17 | 4/17 | – |
| **(b) parse5 + jsoup-style cleaner and serializer** | **16/17** (g07, malformed) | 16/17 | 16/17 | 16/17 | **4,300/4,300** (html, fingerprint, text, assets) |

More results for (b):
- **Links.** `unwrapGoogleRedirect`, hrefs through sanitize and `img src` were each identical on 11,500/11,500.
  That includes **throw parity**: a malformed `%` makes Java's `URLDecoder` throw, which fails the whole Doc, and
  TS throws too.
- **Tag soup.** 534 of the 2,000 docs give different parse5 and jsoup trees. Of the rest, sanitize matches on
  1394/1483, the full pipeline on 1480/1483 and `text()` on 1483/1483.
- **Safety.** On 40,000 hostile documents there were **0 violations**: only safelisted tags and attributes, only
  http/https/ftp/mailto or asset URLs, and no on*, script or style.
- **Speed.** About 0.5 ms per typical Doc. A 470 KB Doc took 511 ms on Bun against 909 ms on Java, and a 1.9 MB
  Doc (near `MAX_HTML_CHARS`) took 1.3 s.
- **It blocks the event loop.** parse5 and the serializer are synchronous. Java runs them on the Drive-sync job thread; in a
  single Bun process they freeze every HTTP request for that long. Checked with a ~470 KB Doc built from the
  corpus:
  - on the main thread: 161 ms with a **161 ms** event-loop gap;
  - in a Bun `Worker` (the same `pipeline.ts`, parse5 loads fine there): 172 ms with a 3 ms gap.

  **Drive-sync Doc processing (HTML and PDF) must run in a `Worker` pool or a separate worker process.** Keep at
  most about 2 Docs in flight, given the memory figures in §3.
- **Limit.** The generator encodes the same understanding as the port. A sample of **real** exports run through
  the goldens is still needed (see "Still to verify").

### Differences the port must copy (and does)

- **linkedom.**
  - It is not an HTML5 tree builder: no implied `<tbody>`, and no html/body for fragments, so content is lost.
  - It does not escape `&` in attributes, and it prints nbsp as `&#160;`.
  - Its `textContent` adds no space between blocks.
- **sanitize-html.**
  - It keeps relative `#h.*` / `#cmnt1` hrefs. jsoup drops them because the base URI is `""`.
  - It drops empty attributes.
  - It has its own entity and whitespace rules.
- **jsoup escaping.** In text, `& < >` are escaped, U+00A0 prints as `&nbsp;`, C0 controls (except
  `\t \n \r`) print as `&#xN;`, and U+0080–9F stay raw. In attributes, `" < > &` are escaped and `'` is not.
- **Attributes.** Boolean attributes collapse only for known boolean names. Attribute order is insertion order.
- **jsoup Cleaner.**
  - It keeps the text of dropped elements (button, option, font, textarea, …).
  - It drops the content of script, style and iframe, and drops comments. CDATA becomes text.
  - It appends enforced `rel` and `target` even to an `<a>` without an href.
- **URLs.** href, src and cite go through `java.net.URL(...).toExternalForm()`:
  - control characters are stripped, the value is trimmed, a `url:` prefix is removed, and the scheme is
    lowercased;
  - an empty authority loses its `//`, and mailto loses its `#fragment`;
  - spaces are not encoded and dot segments are not removed.

  **Never use WHATWG `new URL` here.** The spike's TS port of that behaviour is `javaUrl`.
- **`text()`.** It is a port of jsoup's accumulator: nbsp counts as whitespace, U+200B and U+00AD are dropped, a
  space goes before blocks and `<br>`, and the result is Java-trimmed.
- **parse5 settings.** Run it with `scriptingEnabled: false` (jsoup parses noscript content as markup) and
  `sourceCodeLocationInfo`, which is needed for whitespace after `</body>` and for `<x/>`.
- **Residuals in (b).** All are parser-level, and none appears in realistic Docs:
  - stray text inside `<table>`/`<tr>` (parse5 foster-parents it);
  - text split by ignored tags (parse5 merges the text nodes);
  - `&#0;` / `&#xD800;` (parse5 turns both into U+FFFD);
  - a newline right after `<textarea>`;
  - `<p>` inside `<svg>`.

### Working approach (core of the printer)

```ts
const BLOCK = new Set(("address applet article aside audio blockquote body br button canvas caption center colgroup dd del "
  + "details dir div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html ins li link "
  + "listing main marquee math menu meta nav noframes noscript ol p plaintext pre script section style svg table tbody td "
  + "template tfoot th thead title tr ul video frameset frame col").split(' '));
const INLINE_CONTAINER = new Set('address button del h1 h2 h3 h4 h5 h6 ins li p pre script style title td th plaintext'.split(' '));
const PRESERVE_WS = new Set(['pre', 'plaintext', 'title', 'textarea']);

export function escape(s: string, inAttr: boolean): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '&') out += '&amp;'; else if (c === 0xa0) out += '&nbsp;';
    else if (ch === '<') out += '&lt;'; else if (ch === '>') out += '&gt;';
    else if (ch === '"' && inAttr) out += '&quot;';
    else if ((c < 0x20 && c !== 9 && c !== 10 && c !== 13) || (c >= 0xd800 && c <= 0xdfff)) out += `&#x${c.toString(16)};`;
    else out += ch;
  }
  return out;
}

export function innerPretty(root: El): string {            // = Element.html() with default OutputSettings
  let out = '', preserve = false;
  const indent = (d: number) => { out += '\n' + ' '.repeat(Math.min(d, 30)); };
  const shouldIndent = (n: Node | null): boolean => {
    if (!n || n === root || preserve || isBlankTxt(n)) return false;
    if (n.parent === root && root.children[0] === n) return false;   // never a leading newline
    if (isBlockEl(n)) return true;
    const prev = prevNonBlank(n);
    if (isBlockEl(prev)) return true;
    const parent = n.parent!;
    if (!isBlockEl(parent) || INLINE_CONTAINER.has(parent.name) || !parent.children.some((c) => c.kind !== 'txt')) return false;
    return prev === null || (prev.kind !== 'txt' && (isBlockEl(prev) || prev.kind !== 'el'));
  };
  const visit = (n: Node, depth: number) => {
    if (n.kind === 'el') {
      if (shouldIndent(n)) indent(depth);
      if (n.selfClosing) { out += head(n).slice(0, -1) + ' />'; return; }
      out += head(n);
      if (VOID.has(n.name)) return;
      const was = preserve; if (PRESERVE_WS.has(n.name)) preserve = true;
      for (const c of [...n.children]) visit(c, depth + 1);
      if (shouldIndent(nextNonBlank(n.children[0] ?? null))) indent(depth);   // close on its own line iff first child was
      out += `</${n.name}>`; preserve = was;
    } else if (n.kind === 'cmt' || n.cdata || n.data) {
      if (shouldIndent(n)) indent(depth);
      out += n.kind === 'cmt' ? leaf(n) : n.cdata ? `<![CDATA[${n.value}]]>` : n.value;
    } else if (preserve) out += escape(n.value, false);
    else {
      let tl = false, tt = false;
      if (isBlockEl(n.parent)) {
        const p = prevSib(n), x = nextSib(n);
        tl = p === null || ((p.kind === 'cmt' || isBlockEl(p)) && shouldIndent(p));
        tt = x === null || shouldIndent(x);
      }
      if (!isBlankTxt(n) && isBlockEl(n.parent) && shouldIndent(n)) indent(depth);
      out += normaliseText(n.value, tl, tt);   // collapse [ \t\n\f\r]+ to ' ' (nbsp is not whitespace), trim, escape
    }
  };
  for (const c of [...root.children]) visit(c, 0);
  return javaTrim(out);
}
```

The rest of the port: the compact serializer is the same `head()` and escape without the whitespace logic, the
cleaner holds the Safelist tables and the `javaUrl`/`absUrl` port, and `pipeline.ts` is a line-by-line port of
normalize and sanitize with Java `trim`/`isBlank`/`parseDouble`/`URLDecoder` semantics.

Gotchas:
- **Freeze jsoup 1.21.2's behaviour.** Its printer was rewritten in the 1.21 line, so a jsoup upgrade would have
  changed the Java bytes too.
- **Goldens.** Keep the 1,834 Java outputs (`goldens/`) as the TS regression suite. They currently give 1,832
  identical and 2 known parser diffs (g07). Move them into `apps/api-ts` tests and add real exports before the
  JVM goes.
- **Redirect host check (both stacks).** `unwrapGoogleRedirect` checks `host.endsWith("google.com")`, which also
  matches `evilgoogle.com`. It only unwraps, so it is not a vulnerability, but fix it in Java and TS together or
  the outputs diverge.
- **Lone surrogates.** Java's `getBytes(UTF_8)` turns a lone surrogate into `?`, while `TextEncoder` gives U+FFFD.
- **Fuzzing.** The safety fuzz found two crashes in the port, on frameset documents and on `<template>` inside
  svg. Both are fixed.

### Fallback

1. **Fingerprint guard.** On re-export, map `/files/<rowId>/assets/` back to `__FILE__` and compare the new
   output with the stored `html_content` canonically: same tree, attributes as sets, whitespace collapsed. If they
   are equal and the asset bytes match, keep the old fingerprint. That avoids LLM re-runs even with a non-exact
   port, and it is a cheap safety net to add on top of (b) anyway.
2. **JVM jsoup sidecar.** A tiny long-running process speaking a line protocol. It gives byte parity for free,
   including on malformed input, for one more container of about 100 MB.

## 5. pgvector via `postgres` (porsager)

**Verdict: PASS.** On the same data, the `postgres` driver on Bun returns **the same top-k ids and bit-identical
distances** as JDBC (Java's driver) for all 12 queries. Vector binding as a text literal plus `CAST(... AS vector)`
works unchanged.

Versions: `postgres@3.4.9`, `pgvector/pgvector:0.8.6-pg16-bookworm` (extension 0.8.6). Java: `postgresql` JDBC
42.7.4.

Setup:
- **Schema.** All migrations in `apps/api/src/main/resources/db/migration` (V1…V63, in Flyway version order)
  were applied with `psql` to a fresh database. They all apply cleanly as plain SQL; the only extra step is
  `CREATE SCHEMA wiki` first, which Flyway does from `spring.flyway.schemas`.
- **Data.** 2 subjects, 60 `kb_page` rows (every 10th `HIDDEN`) and 300 `kb_page_chunk` rows with
  deterministic 768-d vectors. Some chunks use a second model.
- **Writes.** Inserts used the exact `KbPageChunkRepository.insert` SQL, including `CAST(${null} AS text)` for
  the nullable heading and anchor.
- **Reads.** 3 query vectors × subject `null` / `S1` × k = 5 / 50, using the exact `findNearest` SQL. Each ran
  inside `sql.begin()` after `set_config('hnsw.iterative_scan', 'strict_order', true)`. The same SQL then ran
  through JDBC (`setString` parameters, `set_config` in the same transaction).

Results:
- **Parity.** Ids are equal on 12/12 queries, and distances are bit-equal as float8 on 12/12.
- **Exactness.** HNSW with `strict_order` returned the exact brute-force top-k on 12/12 (the oracle was computed
  in JS from `embedding::text`). Every filtered query returned the full k.
- **Row types** from `postgres`: `uuid` → string, `varchar`/`text` → string, `distance` (float8) → **number**
  (for example `0.8982058379852494`), nullable heading and anchor → `null`. The embedding read as `::text` is a
  string such as `[0.1,0.1,1e-07,...]`, which `JSON.parse` reads.
- **Null subject.** `CAST(${null} AS varchar) IS NULL` works for the all-subjects case. postgres.js sends an
  untyped null, and the cast fixes its type, as in Java.
- **Literal format.** JS `String(Math.fround(x))` (for example `0.10000000149011612`) and Java's
  `Float.toString` (`0.1`) are stored as the same float4 (round-trip `[0.1,...]`). The text differs, the vectors
  do not.
- **Iterative scan is transaction-local.** Inside `sql.begin()`, `current_setting` reads `strict_order`. On the
  pool outside a transaction, `set_config(..., true)` returns `strict_order`, yet the next statement sees
  `off`. It silently does nothing. Always run it in the same `sql.begin` as the search.

Working approach:

```ts
const sql = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
const literal = (v: Float32Array | number[]) => {
  for (const x of v) if (!Number.isFinite(x)) throw new Error('embeddings: non-finite value in vector');
  return '[' + Array.from(v).join(',') + ']';
};

const findNearest = (q: string, model: string, subjectId: string | null, k: number) =>
  sql.begin(async (tx) => {
    await tx`SELECT set_config('hnsw.iterative_scan', 'strict_order', true)`;
    return tx<Hit[]>`
      SELECT c.id, p.id AS page_id, p.subject_id, p.slug, p.title, c.heading, c.anchor, c.content,
             c.embedding <=> CAST(${q} AS vector) AS distance
      FROM wiki.kb_page_chunk c JOIN wiki.kb_page p ON p.id = c.page_id
      WHERE p.status = 'PUBLISHED' AND c.model = ${model}
        AND (CAST(${subjectId} AS varchar) IS NULL OR p.subject_id = CAST(${subjectId} AS varchar))
      ORDER BY c.embedding <=> CAST(${q} AS vector)
      LIMIT ${k}`;
  });
```

Gotchas:
- **NOTICEs.** `postgres` prints server NOTICEs (for example "truncate cascades to …") to the console by default.
  Pass `onnotice` to route them to the logger or drop them.
- **Read-only transactions.** Java runs the search in a read-only transaction (`readTx`). The equivalent is
  `sql.begin('read only', …)`.
- **Drizzle.** The query was tested as raw SQL. If Drizzle is adopted, keep these vector queries as
  `` sql`...` `` fragments: there is no reason to model the `vector` type for one query.

## 6. SMTP and Gmail MIME via nodemailer

**Verdict: PASS-with-caveats.**
- **What matches.** nodemailer on Bun delivers to an SMTP sink. Parsed with `mailparser`, its messages match the
  Java ones field for field: From (name and address), To, Subject (with accents, an emoji and an em dash),
  `List-Unsubscribe`, `List-Unsubscribe-Post`, the decoded text and the decoded HTML. `MailComposer` gives the
  RFC 822 bytes for the Gmail API `raw` field.
- **What differs.** The MIME tree is not the same shape. The From header differs too, and the Java version is
  the less correct one.

Versions: `nodemailer@10.1.7`, `mailparser@3.10.0`, mailpit v1.31.6 (`axllent/mailpit`). Java: Spring
`MimeMessageHelper` + Angus `jakarta.mail` 2.0.3.

Setup:
- **Message.** One `OutgoingEmail` with From `CEITBA Ñandú <ceitba@itba.edu.ar>`, a non-ASCII subject, long QP
  lines, a 160-character `List-Unsubscribe` and `List-Unsubscribe-Post`.
- **Java.** The real `SmtpEmailSender` sent it to mailpit through a `JavaMailSenderImpl`. The real
  `GmailApiEmailSender.mime()` wrote the raw bytes.
- **Bun.** `nodemailer.createTransport().sendMail()` sent it to mailpit, and `new MailComposer(mail).compile().build()`
  produced the raw bytes.
- **Comparison.** All 4 messages were parsed with `mailparser`.

| Aspect | Java | nodemailer | Matters? |
|---|---|---|---|
| MIME tree | `multipart/mixed > multipart/related > multipart/alternative > text/plain, text/html`. `new MimeMessageHelper(msg, true, …)` defaults to MIXED_RELATED | `multipart/alternative > text/plain, text/html` | No. Clients render the same, and the simpler tree is what the `GmailApiEmailSender` comment already describes ("multipart/alternative"). Byte parity is impossible anyway: boundaries and Message-IDs are random |
| From display name | **raw 8-bit UTF-8** in the header (`From: "CEITBA Ñandú" <…>`), because `new InternetAddress(from, true)` keeps the personal part unencoded | RFC 2047 `=?UTF-8?Q?CEITBA_=C3=91and=C3=BA?=` | nodemailer is more correct. Prod `MAIL_FROM` is `CEITBA <ceitba@itba.edu.ar>` (ASCII), so nothing changes in practice |
| Subject | RFC 2047 Q, split differently | RFC 2047 Q | Same decoded value |
| `List-Unsubscribe` | one long line | folded after the colon | Same unfolded value. Both are valid (under 998 chars) |
| Message-ID | Gmail path: `<uuid@itba.edu.ar>` (overridden). SMTP path: JavaMail's default (`@localhost` here, the container hostname in prod) | whatever `messageId` is set to (`<uuid@from-domain>` in the spike) | Set `messageId` explicitly on both paths |
| Body encoding | quoted-printable, `charset=UTF-8` | quoted-printable, `charset=utf-8` | Same decoded bodies |

Working approach:

```ts
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';

const domain = fromAddress.split('@')[1];
const toMail = (e: OutgoingEmail) => ({
  from: env.MAIL_FROM, to: e.to, subject: e.subject, text: e.text, html: e.html,
  headers: e.headers,                          // List-Unsubscribe, List-Unsubscribe-Post
  messageId: `<${crypto.randomUUID()}@${domain}>`, date: new Date(),
});

// SMTP (SmtpEmailSender): smtp.gmail.com:587 STARTTLS with the app password
const smtp = nodemailer.createTransport({ host, port: 587, secure: false, requireTLS: true, auth: { user, pass } });
await smtp.sendMail(toMail(email));

// Gmail API (GmailApiEmailSender): users.messages.send with base64url `raw`
const raw = (await new MailComposer(toMail(email)).compile().build()).toString('base64url'); // no padding
await fetch(SEND_URL, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                        body: JSON.stringify({ raw }) });
```

Gotchas:
- **Error classification.** `SmtpEmailSender.classify` regex-matches reply text such as `550 5.4.5`. With
  nodemailer, use `err.responseCode` and `err.response` (the full reply line), plus `err.code` (`EAUTH`,
  `ESOCKET`, `ECONNECTION`, `ETIMEDOUT`) and `err.rejected` for invalid recipients. The spike only exercised
  `ESOCKET` (connection refused). The 4xx/5xx mapping table ports directly onto `responseCode` + `response`.
- **TLS.** The spike sent in plaintext to mailpit (`ignoreTLS`). The production relay settings (STARTTLS on
  smtp.gmail.com) were not tested, because no credentials were available.

**Fallback:** none needed. For the Gmail path, a hand-built multipart/alternative body is about 30 lines if
nodemailer is unwanted.

## 7. S3 presign vs MinIO

**Verdict: PASS-with-caveats.**
- **What works.** `@aws-sdk/s3-request-presigner` produces URLs with the same path, the same signed headers
  (`content-length;content-type;host`), the same expiry and the same `response-content-*` overrides as
  `S3ObjectStorage`.
- **How MinIO responded.** It enforced the presigned PUTs the same way for Java's URL and the SDK's: exact
  headers gave 200, a wrong Content-Type gave 403 `SignatureDoesNotMatch`, and a wrong length gave 403.
  Presigned GETs returned the requested Content-Type and Content-Disposition.
- **Caveat.** This parity holds **only** with two non-default settings (below). `Bun.S3Client.presign` is not a
  drop-in replacement.

Versions: `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` 3.1154.0, Bun 1.4.0 `Bun.S3Client`,
`pgsty/minio:RELEASE.2026-08-04T00-00-00Z`. Java: AWS SDK v2 2.55.6.

| URL | `X-Amz-SignedHeaders` | Extra query params | Wrong Content-Type | Wrong length |
|---|---|---|---|---|
| Java `presignPut` | `content-length;content-type;host` | none | 403 | 403 |
| SDK v3, `signableHeaders` + `WHEN_REQUIRED` | `content-length;content-type;host` | `X-Amz-Content-Sha256=UNSIGNED-PAYLOAD`, `x-id=PutObject` | 403 | 403 |
| SDK v3, **defaults** | `content-length;host` | as above, plus `x-amz-checksum-crc32=AAAAAA==`, `x-amz-sdk-checksum-algorithm` | **200 (accepted)** | 403 |
| `Bun.S3Client.presign({ type })` | `host` | `response-content-type` | **200** | **200** |

Working approach:

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: env.STORAGE_REGION ?? 'us-east-1', endpoint: env.STORAGE_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',     // else a CRC32 of the *empty* body is baked into the URL
  responseChecksumValidation: 'WHEN_REQUIRED',
});

async function presignPut(key: string, contentType: string, contentLength: number) {
  const ttl = env.STORAGE_PRESIGN_TTL_SECONDS ?? 600;
  const uploadUrl = await getSignedUrl(s3,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
    { expiresIn: ttl, signableHeaders: new Set(['content-type', 'content-length']) }); // else Content-Type is NOT signed
  // Java derives this map from signedHeaders() (Host dropped); here it is rebuilt by hand.
  const headers = { 'Content-Length': String(contentLength), 'Content-Type': contentType };
  return { uploadUrl, headers, expiresAt: new Date(Date.now() + ttl * 1000) };
}
```

`presignGet` is a `GetObjectCommand` with `ResponseContentDisposition` / `ResponseContentType`. On the spike's
filename, the ported `disposition()` helper gave the same `response-content-disposition` as Java. Java's
`URLEncoder.encode(…).replace("+", "%20")` maps onto
`encodeURIComponent(name).replace(/[!'()~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())`.
`URLEncoder` encodes `!'()~` and leaves `*` alone, while `encodeURIComponent` leaves all six (`!'()*~`)
unencoded. That was checked on `a!b'c(d)e*f~g h+ñ.pdf`. The `filename*` value is only a hint to the browser, but a unit test should
pin it.

Gotchas:
- **Content-Type is not signed by default.** Without `signableHeaders`, SDK v3 signs only `content-length;host`.
  A client could then upload `text/html` to a URL meant for `image/png`. The spike confirmed this against MinIO
  (200). That would weaken the upload contract, so it must be in the port and covered by a test.
- **Checksum params in the URL.** Recent SDK v3 versions add `x-amz-checksum-crc32` of the empty payload and
  `x-amz-sdk-checksum-algorithm` to presigned PUTs. MinIO ignored the mismatch in the spike, but AWS S3 rejects
  it. Set `requestChecksumCalculation: 'WHEN_REQUIRED'`.
- **Extra query params.** The SDK adds `X-Amz-Content-Sha256` and `x-id`. That is harmless, but URL-shape
  snapshot tests must allow for it.
- **Bun's native client.** `Bun.S3Client.presign` cannot sign Content-Type or Content-Length (it maps `type` to
  `response-content-type`). Use it at most for `put`/`get`/`delete`, the Drive-sync blob I/O, not for presigned
  uploads.

**Fallback:** none needed.

## 8. Bun runtime basics

**Verdict: PASS.** Advisory locks behave the same as `JobLock`, provided each run uses a dedicated session.
SIGTERM drains in-flight requests when Bun runs as PID 1. Idle memory is tiny.

Versions: `oven/bun:1.4.0-slim`, `hono@4.13.13`, `postgres@3.4.9`.

### 8a. Job locks (`scheduling/JobLock`)

`JobLock` takes a **session-level** `pg_try_advisory_lock(0x43454954, job.id)` on a dedicated JDBC connection
outside the Hikari pool. Under that lock it claims `public.scheduled_job_run`, with a `MIN_GAP` of 30 s.
Closing the connection ends the session, which frees the lock even when the unlock fails or the process dies.

The spike ported it to Bun against the migrated schema:

| Check | Result |
|---|---|
| Two concurrent runs of one job ("blue" and "green") | `[false, true]`: exactly one ran; the other logged "another process is running it" |
| The same tick again right after | skipped by the claim ("started <30 s ago"), as in Java |
| Holder process `SIGKILL`ed | lock free immediately afterwards (`pg_try_advisory_lock` false while the holder was alive, true after the kill) |
| `sql.reserve()` and then `release()` without unlocking | **the lock stays held** (`pg_locks` count 1) by a pooled connection that other requests will reuse |

Working approach. Do **not** use `sql.reserve()`. Use a short-lived single-connection client per run, the
equivalent of Java's `DriverManager.getConnection`:

```ts
export async function runExclusively(job: Job, task: () => Promise<void>): Promise<boolean> {
  const conn = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 10, onnotice: () => {},
                                            connection: { application_name: 'ceitba-api job lock' } });
  try {
    const [{ locked }] = await conn`SELECT pg_try_advisory_lock(${NAMESPACE}, ${job.id}) AS locked`;
    if (!locked) return false;                                   // another process is running it
    try {
      const claimed = await conn`INSERT INTO public.scheduled_job_run (job_id, job_name, last_started_at)
        VALUES (${job.id}, ${job.name}, now())
        ON CONFLICT (job_id) DO UPDATE SET job_name = EXCLUDED.job_name, last_started_at = EXCLUDED.last_started_at
        WHERE public.scheduled_job_run.last_started_at < now() - make_interval(secs => ${MIN_GAP_S})`;
      if (claimed.count === 0) return false;                     // the other color started this tick
      await task();
      return true;
    } finally {
      await conn`SELECT pg_advisory_unlock(${NAMESPACE}, ${job.id})`.catch(() => {});
    }
  } catch { return false; }                                      // DB unreachable: skip, next tick retries
  finally { await conn.end({ timeout: 5 }); }                    // ends the session: frees the lock no matter what
}
```

The trade-off is one extra connection per running job, as in Java. Keep `max_connections` headroom: 12 job ids
plus the request pool, times two colors during a deploy.

### 8b. Graceful SIGTERM in a container

- **Test.** Hono + `postgres` pool ran in `oven/bun:1.4.0-slim` as PID 1 (`CMD ["bun", "server.ts"]`, no init
  wrapper). A `GET /slow` (`pg_sleep(3)`) was in flight when `docker stop` ran.
- **Result.** The handler saw `SIGTERM` with 1 pending request. `await server.stop(false)` resolved only once the
  request completed. The client got **200** after 3.0 s, then `sql.end({ timeout: 5 })` closed the pool, and the
  container exited with **code 0**, about 2.5 s after the signal.
- **Bun as PID 1.** It receives the signal and runs the JS handlers, so no `tini` is needed as long as a handler
  is installed.

```ts
process.on('SIGTERM', async () => {
  draining = true;                     // health answers 503 so the blue/green switch stops routing here
  await server.stop(false);            // stop accepting; resolves after in-flight requests finish
  await sql.end({ timeout: 5 });
  process.exit(0);
});
```

Not tested: long-lived streaming responses (SSE / share-session websockets) during a drain, which
`stop(false)` would wait on indefinitely. Give it a deadline, then call `stop(true)`.

### 8c. Idle memory (early lower bound)

Same procedure as `docs/plans/api-bun-baseline.md`:
- `--memory 2g`, Postgres in `pgvector/pgvector:0.8.6-pg16-bookworm`, warm pool of 10 connections, no traffic.
- Sampling: 60 s after boot, `scripts/bench/idle-stats.sh spike-bun 300 idle.csv`.
- The app is only Hono + `postgres`, so this is a floor, not a forecast.

| Metric | Bun hello-world | Java API (baseline) |
|---|---|---|
| `docker stats` memory, idle | avg **16.2 MiB** (min 16.1, max 17.4) | avg 735 MiB |
| CPU, idle | avg 0.08%, p95 0.43%, max 1.21% | avg 0.50%, p95 0.81% |
| Process RSS (`/proc/1/status`) | VmRSS 49 MiB, VmHWM 52 MiB | – |

- **Why two memory numbers.** `docker stats` subtracts reclaimable page cache, so it reports less than the RSS,
  which includes the mapped Bun binary. Compare the `docker stats` column with the Java baseline, which used the
  same tool.
- **Library cost.** On the host, importing the heavy libraries the API needs adds about 30 MiB of RSS:
  firebase-admin/messaging, `@googleapis/drive`, `@aws-sdk/client-s3` + presigner and nodemailer (31 → 60 MiB).
  A realistic idle figure for the full API is therefore likely ≤ 150 MiB, before caches.
- **Real limit.** Memory pressure will come from work, not idle. PDF extraction of a 45 MB text-heavy file
  peaks at about 343 MB even with the early stop (§3), so cap concurrent Drive extractions.

## Changes to the plan

1. **Content fingerprints need byte parity.** `content_fingerprint` hashes the **output** of jsoup (Docs) and
   pdfbox (Slides/Sheets exports), and the KB re-digests on any change. Treat byte-identical HTML and PDF text as
   a requirement of the Drive area, with the Java outputs frozen as goldens, not "normalised whitespace". Add a
   fingerprint-guard fallback (canonical comparison with the stored content) as a safety net.
2. **HTML needs a custom port.** Budget about 600 lines of parse5-based cleaner and jsoup-style serializer
   instead of linkedom with sanitize-html. The spike's port is a working starting point.
3. **PDF text has open decisions.** Use unpdf/pdfjs for uploaded PDFs, which are md5-keyed. Before cutover, run
   the recompute-and-compare gate on stored Slides/Sheets exports. Decide what to do about the Calibri ligature
   damage: accept it, use mupdf (AGPL, needs sign-off) or keep a pdfbox sidecar.
4. **Firestore is not an API dependency.** `FirestoreImportService` takes a JSON export, so remove "reads a
   Firestore export" from the firebase-admin spike's scope. The one-off `export.mjs` already runs on Bun
   unchanged.
5. **CPU-heavy Drive work goes off the event loop.** Sanitizing a 470 KB Doc blocks it for about 160 ms, and a
   1.9 MB one for about 1.3 s. Run Drive content processing in a `Worker` pool or a separate worker process,
   with bounded concurrency. Plan this in phase 3 (foundation), not phase 4.
6. **Known hand-ports.** The Drive retry policy (gaxios defaults differ), SMTP error classification on
   `responseCode`, S3 presign headers, and `JobLock` on a dedicated client.

## Still to verify with real credentials

These are the plan's original pass conditions, which no spike could run without credentials:
- one real FCM push to a test device, on the default HTTP/2 transport as shipped (fallback:
  `enableLegacyHttpTransport()`);
- a real Apuntes folder listed and downloaded within quota;
- 20 real Apuntes PDFs, plus the Slides/Sheets fingerprint gate on stored exports;
- 20 real Docs exports through the HTML goldens;
- KB top-k against the production embeddings;
- an SMTP send through smtp.gmail.com:587 STARTTLS, and a Gmail API send;
- the LLM batch spike, which was not part of this run.
