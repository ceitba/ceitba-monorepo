# Subject wikis

LLM-written Markdown wikis, one per subject, built from the published Drive files ("Apuntes")
and cross-linked between subjects. Full design:
https://claude.ai/code/artifact/fc40934b-7324-4fa7-a45a-6657f42a98c7

Phase 1 (now): pages are written outside the API (by hand / by Claude) and imported through the
staff import endpoint. Phase 2: an in-API pipeline calling DigitalOcean serverless inference writes
through the same service.

## Page format

One folder per subject id; one `.md` file per page; `index.md` is the subject's home page.

```
61.12/
  index.md
  valor-tiempo-del-dinero.md
```

Frontmatter (YAML, all keys required unless marked optional):

```yaml
---
title: Valor tiempo del dinero
subject: "61.12"
type: concept            # index | topic | concept
summary: Una oración que resume la página.
aliases: [VTD]           # optional, default []
sources: [<drive_file uuid>, ...]   # files the page draws on; must be PUBLISHED files of this subject
generator: claude-opus-5.5/manual   # or do:<model id>
generated_at: 2026-10-02
---
```

Slug = file name without `.md`: lowercase ASCII, digits and hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`).
`index` is reserved for the `index` page; every subject wiki has exactly one.

Body: GitHub-flavored Markdown, KaTeX math (`$…$`, `$$…$$`), plus wikilinks:

| Syntax | Target |
|---|---|
| `[[slug]]`, `[[slug\|text]]` | page in the same subject |
| `[[61.12/slug]]`, `[[61.12/slug\|text]]` | page in another subject |
| `[[61.12]]`, `[[61.12\|text]]` | another subject's index |
| `[[file:<uuid>]]`, `[[file:<uuid>\|text]]` | citation of a source file |
| `[[slug#anchor\|text]]`, `[[61.12/slug#anchor\|text]]`, `[[#anchor\|text]]` | a section of a page (`[[#…]]` = same page) |

Anchors are heading text folded: lowercase, accents removed (NFD, combining marks dropped), runs of non-`[a-z0-9]`
replaced by `-`, trimmed of `-` (`## Cómo se calcula` → `como-se-calcula`). A link whose anchor matches no `##`–`####`
heading of its target page is rejected **when the target page exists** (in the same import, else stored and not
`REMOVED`); links to pages that don't exist yet stay unresolved.

Writing rules: Spanish (rioplatense, voseo), didactic; every `##` section contains at least one
`[[file:…]]` citation; never more than 40 consecutive words copied from a source; pages never name students.

## Validation (on import)

A page is **rejected** (the previous revision stays) when:
- frontmatter is missing/invalid, `subject` doesn't match the folder, slug invalid, or `type: index` on a non-`index` slug;
- a `##` section has no `[[file:…]]` citation;
- it cites a file not in its `sources`, or a source that is not a `PUBLISHED` file whose effective subject is this subject;
- a citation has a space after `file:` (`[[file: <id>]]`; reason `citation_format`);
- `latex_format`: a math command (`\bar`, `\frac`, `\sum`, `\pm`, `\sqrt`, Greek letters, …) outside `$…$`/`$$…$$`, a
  doubled backslash before letters (`\\bar`), a line ending in a stray backslash, or an unbalanced `$` (write a literal
  dollar as `\$`);
- `meta_section`: a heading or bullet that is a note to the editor, not content (`Qué falta`, `TODO`, `FIXME`,
  `Pendiente`, `Por completar`, `A completar`, `Agregar enlaces…`);
- `self_link`: a wikilink to the page's own slug (`[[slug#heading]]` and `[[#heading]]` are fine);
- it copies ≥ 40 consecutive words from a source's extracted text (normalized: lowercase, collapsed whitespace).

Code spans and fences are ignored by the three style checks (`KbStyleChecks`). Each error text starts with its reason,
which feeds `rejectReasons` and the retry prompt.

Not fatal: wikilinks to pages that don't exist (kept in `kb_link` with `to_page_id = null` and rendered as plain
text by the frontend; resolved automatically when the target appears later).

## API

Readers (logged in, allowlisted):

| Method + path | Response |
|---|---|
| `GET /v1/wiki/subjects/{subjectId}/kb` | `{ subjectId, subjectName, index: Page \| null, pages: PageSummary[], related: [{ subjectId, subjectName, reason, hasWiki }] }` |
| `GET /v1/wiki/subjects/{subjectId}/kb/{slug}` | `Page` |
| `GET /v1/wiki/subjects/{subjectId}/kb/graph` | `{ nodes: [{ id, subjectId, slug, title, type, external }], edges: [{ from, to }] }` — this subject's pages plus the pages of other subjects they link to or are linked from (`external: true`) |
| `PUT /v1/wiki/kb/pages/{pageId}/report` | body `{ reason, comment }`, reason ∈ `CONTENT_ERROR, COPYRIGHT, PERSONAL_DATA, SPAM, OTHER` → 204 |

`PageSummary` = `{ id, slug, title, type, summary, aliases }`

`Page` = `PageSummary` + `{ subjectId, subjectName, markdown (body without frontmatter), sources: [{ id, name, kind, author: { name, anonymous }, academicYear, academicYearSource }],
sourceYears: { min, max }, stale,
links: [{ raw, subjectId, slug, anchor, resolved, title }], backlinks: [{ subjectId, subjectName, slug, title }], generator, generatedAt, revision, reportedByMe }`

`links` maps every wikilink target in the body (`raw` = the inner text before `|` including any `#anchor`, e.g. `81.07/balance`, `van-y-tir#como-se-calcula`, `81.07`;
`anchor` = the folded anchor or `null`)
to its resolution, so the frontend can render `[[…]]` without extra calls. File citations are not in `links`;
they reference `sources`.

Only `PUBLISHED` pages are visible to readers; staff see all.

Staff (`/v1/staff/**`, STAFF):

| Method + path | Body / response |
|---|---|
| `POST /v1/staff/kb/subjects/{subjectId}/import` | `{ pages: [{ path: "slug.md", content: "<full file with frontmatter>" }], replace: true }` → `{ accepted: [slug], rejected: [{ slug, errors: [string] }], removed: [slug] }`. `replace: true` removes pages of the subject that are not in the payload. One transaction; bumps `revision` of changed pages and keeps the previous version in `kb_page_revision`. |
| `POST /v1/staff/kb/pages/{pageId}/hide` · `/restore` | `Page` |
| `GET /v1/staff/kb/pages?status=HIDDEN&page=0&limit=20` | `{ items: [PageSummary + { subjectId, status, reportCount }], total }` |

Takedown hook: whenever a file stops being `PUBLISHED` (removed or blocked by staff, hidden by 3 reports, hidden by the
student, moved to another subject, source revoked or disconnected, account deleted, file deleted), every page whose
`sources` contains it is set to `HIDDEN` (`TAKEDOWN`) immediately; the pipeline rewrites the subject on its next run.

## Local import

`scripts/kb-import.sh <dir> [baseUrl]` — for each `<dir>/<subjectId>/` folder, POSTs all `.md` files to the import
endpoint using a dev-login staff session cookie, and prints accepted/rejected pages.

## Embeddings (semantic search / RAG)

Every `PUBLISHED` page is cut into chunks and embedded into `wiki.kb_page_chunk` (pgvector, V61), so pages can be
retrieved by meaning (`KbEmbeddingService.search`). There is no HTTP endpoint yet; it is the building block for RAG.

- **Chunks** (`KbChunker`): chunk 0 = title, summary and the text before the first `##`; then one chunk per `##`
  section (its `###` subsections included), split at blank lines above 6000 characters. Every chunk carries a title
  (the page title, plus its heading), so it is self-describing; title and body go into the model's document prompt
  (`title: {title} | text: {text}` for EmbeddingGemma). Wikilinks are reduced to their text and bare `[[file:…]]`
  citations dropped. Each row keeps the heading and its anchor, so a hit links to `subject/slug#anchor`.
- **Indexing** (`KbEmbeddingJob`, every `KB_EMBEDDING_INTERVAL`, default 5 min): a page is pending when it has no
  chunks for its current `revision` and the configured model. Imports and pipeline runs only bump `revision`; the
  next sweep re-embeds the page and replaces its rows in one transaction (the HTTP call runs outside it, and a page
  edited meanwhile is left for the next sweep). Rows of `HIDDEN`/`REMOVED` pages stay; searches only return
  `PUBLISHED` pages, and a restored page needs no new vectors. Until the sweep reaches an edited page, searches
  still return its previous chunks (slightly stale rather than missing). A failing page is skipped until the next sweep; an
  endpoint problem (server unreachable, 401/403/404, wrong vector length) ends the sweep at once.
- **Search**: cosine kNN (`<=>`) over an HNSW index, optionally limited to one subject (pgvector 0.8 iterative scans
  keep filtered searches from coming back short). Queries use the model's query prompt
  (`task: search result | query: {query}`).
- **Model (self-hosted)**: [EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2) (Google, Apache 2.0,
  Oct 2026): 740M parameters (270M text + vision/audio encoders), 100+ languages, 768 dimensions, 8k-token context.
  It is multimodal: text, images, audio and video share one vector space, so image embeddings (e.g. scanned Apuntes)
  can be added later next to the existing text vectors without re-embedding anything.
- **Serving**: the `ceitba-embeddings` compose service, llama.cpp's server (`ghcr.io/ggml-org/llama.cpp:server-b11515`,
  pinned by digest) on the CPU with the `Q8_0` GGUF (310 MB), reachable only inside the compose network at
  `http://ceitba-embeddings:8080/v1`. `ceitba-embeddings-model` downloads the GGUF once into the `embedding_models`
  volume, pinned to a Hugging Face commit and checked against its sha256. Measured (2 threads): ~220 MB RAM, ~30 ms per
  query. Text only for now: images need the model's `mmproj` file and `--mmproj` (~+500 MB RAM) and a call to
  llama.cpp's native `/embedding` (the media marker comes from `GET /props`); tried by hand, a Spanish text query
  ranked the right image first in 4/4 cases.
- **Other servers**: any OpenAI-compatible `/v1/embeddings` works (`KB_EMBEDDING_BASE_URL`, `KB_EMBEDDING_API_KEY`,
  and `KB_EMBEDDING_QUERY_TEMPLATE` / `KB_EMBEDDING_DOCUMENT_TEMPLATE` for another model's prompts). Empty base URL
  (the default outside compose) = nothing is embedded and `search` throws `FeatureNotConfiguredException`.
- **Changing the model**: rows record their model, so a new `KB_EMBEDDING_MODEL` re-embeds every page on the next
  sweeps (old rows are replaced page by page; until then searches only see pages already re-embedded). The column is
  `vector(768)`: a model with another length needs a migration (and `KbPageChunk.DIMENSIONS`).
- **Database image**: `pgvector/pgvector:0.8.6-pg16-bookworm` (Debian) replaced `postgres:16-alpine` in
  `docker-compose.yml` and in the tests (`SharedPostgres`). The existing volume works as is (same PG16 format; the
  entrypoint re-chowns the data directory), but musl and glibc sort `en_US.utf8` text differently, so text indexes
  built under alpine are out of order under glibc. V60 rebuilds every index of `public`/`wiki` before V61 installs
  the extension; nothing has to be run by hand.

## Implementation notes (as built)

- `sourceYears` = min/max `academicYear` of the listed sources (both `null` without any); `stale` = `max` is older than
  current year − `KB_STALE_YEARS` (default 3). The kb export can read `wiki.drive_file.academic_year`.
- `Page` also carries `status` (`PUBLISHED | HIDDEN | REMOVED`; readers only ever get `PUBLISHED`). `type` is lowercase
  (`index | topic | concept`) everywhere. `generatedAt` is an ISO timestamp (a frontmatter date becomes midnight UTC).
- `GET .../kb`: `pages` lists every visible page **including** the index (index, then topics, then concepts, by
  title); `index` is `null` when there is none. `related` has one entry per subject, reason priority
  `PREREQUISITE` > `DEPENDENT` > `LINKED`; prerequisite/dependent pairs come from `plan_subject.dependencies` of every
  plan (`wiki.kb_subject_relation`, refreshed on startup and nightly at 04:30); `LINKED` is computed at read time from
  `kb_link` (links from this wiki, or from published pages of other wikis into it). `hasWiki` = the subject has at least
  one `PUBLISHED` page.
- Staff see `HIDDEN` pages in the reader endpoints too (never `REMOVED`). `links[].resolved` = the target page exists
  and the caller can see it (`title` is `null` otherwise). `sources` keeps frontmatter order; readers only get
  `PUBLISHED` files. `backlinks` lists visible pages linking to this one.
- Import: `HIDDEN` pages stay hidden when re-imported (staff `restore` them); `REMOVED` pages come back as
  `PUBLISHED`. Rejected pages count as present for `replace`. A page whose content is unchanged keeps its `revision`.
  Unknown subject → 404. Slug `graph` is reserved (it would collide with `/kb/graph`). "Exactly one index" is not
  enforced beyond `index.md` ⇔ `type: index` (a subject may have no index yet).
- Copy check: both sides are lowercased, wikilink syntax, Markdown and punctuation are dropped and whitespace collapsed
  before comparing 40-word runs, so formatting cannot hide a copy.
- Reports: one per user and page, re-reporting replaces it; only `PUBLISHED` pages can be reported (or re-reported by
  an existing reporter). At 3 the page becomes `HIDDEN`. Staff `restore` sets `PUBLISHED` and dismisses the reports.
  `GET /v1/staff/kb/pages` defaults to `status=HIDDEN`.
- Takedown hook: `DriveRecalculator` calls it for every file leaving `PUBLISHED` (or changing subject); disconnect,
  account deletion and the 30-day purge call it (via `KbModerationService.forgetFiles`) before deleting rows.
- Account deletion removes the user's `kb_page_report` rows (page counters adjusted).
- `scripts/kb-import.sh <dir> [baseUrl]`: `baseUrl` includes `/api/v1` (default `${BASE:-http://localhost:8081}/api/v1`);
  `KB_STAFF_EMAIL` (default `kb-import@itba.edu.ar`) and `KB_REPLACE` (default `true`) are optional. Exit status is
  non-zero when any page was rejected or a request failed.
