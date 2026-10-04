# Weekly digest email — "La semana en ITBA"

Every Monday CEITBA emails its followers one digest of the whole newsletter:
everything published last week (every organization, plus independent
articles) and every event of the coming week. That content is the same for
every recipient; below it each reader gets a short personal block,
"Tu cuatrimestre" (their subjects, wiki links and schedule corrections to
confirm). Staff review, edit and send it from the ItbaNews admin area.

Code: `service/digest/*` (selection, rendering, lifecycle, sending worker,
`DigestTrackingService`), `service/digest/personal/*` ("Tu cuatrimestre"),
`service/mail/*` (transport, `MailSendService` = sending-quota ledger,
`MailLinkRewriter`, `MailClientClass`), `scheduling/DigestJob`,
`web/digest/DigestController`, `web/mail/MailTrackingController`.
Schema: `V45__weekly_digest.sql`; "Tu cuatrimestre" adds only
`V46__saved_schedules_payload_updated_at.sql`;
`V47__mail_quota_tracking.sql` (quota ledger + open/click tracking).

## How it works

**Issues.** One `digest_issues` row per covered week (`week_start` is that
week's Monday, unique). Status: `draft` → `sending` → `sent`, or `draft` /
`sending` → `cancelled`.

- **Monday 00:05 ART** the job creates the draft for the week that just ended
  (idempotent), with `auto_send_at` = that Monday 12:00 ART. The 5-minute
  tick and the startup run the same creation as a catch-up for downtime, but
  only from Monday 00:05 until Tuesday 00:00 ART, so a draft staff deleted or
  cancelled is not recreated later in the week. A draft created after 12:00
  gets no auto-send time (staff review and send it).
- Staff can edit the subject, a plain-text intro (escaped; newlines become
  line breaks), exclude articles/events, preview, send themselves a test,
  send now, or cancel. `autoSendAt: null` disables auto-send for that issue;
  a changed `autoSendAt` (PATCH, or on create) must be in the future, else
  `400 AUTO_SEND_IN_PAST` (re-sending the stored value is fine).
- **Every 5 min** (`DIGEST_TICK_INTERVAL`) drafts whose `auto_send_at` has
  passed start sending. A draft whose auto-send time is more than 24h in the
  past (the API was down for days) is left for staff instead of sending stale
  news. A due draft with nothing to send (no items, or all excluded) is set
  to `cancelled` and logged instead of sending an empty email. Staff can
  also create an issue for any week by hand (no auto-send).

**Content of an issue.** The same for every recipient:
- Articles with `status = published` and `published_at` in
  `[week_start, week_start + 6]`, from every organization and org-less
  (independent) ones.
- Events with `event_date` in `[week_start + 7, week_start + 13]` (the week
  after the covered one), with or without an organization.
- Minus whatever staff excluded. Sending an issue with nothing left is
  refused with `409 DIGEST_EMPTY`.

**Recipients.** Users who follow `ceitba` (every user does by default), have
`digest_email_enabled = true` and an email on a `DIGEST_ALLOWED_DOMAINS`
domain. `recipientEstimate` in the detail is that count, computed with a
count query and only for drafts (`null` once sending started).

**Rendering.** The shared content is rendered once per issue
(`DigestRenderer.template`); per recipient only the unsubscribe link and the
"Tu cuatrimestre" block are spliced in (between the content and the footer).
The block comes from the `DigestPersonalSection` extension point, which is
asked for several recipients at once (`forReaders`; a fixed number of
queries, about ten, whatever the number of readers). The sending worker
claims one delivery at a time, so it asks for that one reader. If loading it
fails, that email goes out without the block instead of not at all. Previews and test sends show the
caller's own block.

## "Tu cuatrimestre" (per reader)

Code: `service/digest/personal/*` (`DigestTerm` = current-term rule,
`CorrectionPrompts` = which corrections, `PersonalDigestLoader` = batch
loading, `PersonalDigestRenderer`, `TuCuatrimestreSection` = the bean),
`service/digest/DigestCorrectionVote*` (links and endpoints).

**Nothing at all** is rendered between terms: when no commission is running
or starts within 14 days (ART), the block is omitted for everyone.
Otherwise, per reader:

1. **Subjects** of their **primary** saved schedule (`saved_schedules`,
   `is_primary`), if it belongs to the current term. Otherwise (no primary
   schedule, unparsable payload, or a stale one) only a call to action:
   "Armá tu horario en el combinador" → `DIGEST_SCHEDULER_URL`.
2. **Wiki links**: for each of those subjects with a `PUBLISHED`
   `wiki.kb_page`, a link to CeitbaPage's Apuntes reader,
   `${DIGEST_WIKI_BASE_URL}/<subjectId>?vista=wiki` (the subject's wiki tab;
   without an index page, `/<subjectId>/wiki/<latest slug>`). Only for
   readers with the `apuntes` capability (the reader is capability-gated;
   checked for the whole page in four queries). Marked "actualizado esta
   semana" when a page's `generated_at` falls in the covered week (ART).
   At most `DIGEST_MAX_WIKI_LINKS` (5).
3. **Corrections to confirm**: `PENDING` schedule corrections on the
   reader's own commissions that they did not suggest and have not voted on,
   most confirmed first, then oldest; at most `DIGEST_MAX_CORRECTIONS` (3):
   "Alguien reportó que Física I (com. A) se dicta martes 09:00 a 12:00 en
   vez de lunes 08:00 a 11:00. ¿Es así?" with **Sí, es así** / **No**
   buttons. The suggester is never named. A reader's "own" commission is
   only known when the schedule names exactly one commission for the
   subject ("any" or several alternatives = no prompts for that subject).

The audience, the `@itba.edu.ar` guard and the opt-out are unchanged: the
block is only ever added to an email that would be sent anyway.

**What "current term" means** (`DigestTerm`). Commission rows carry no
year/period, only `course_start`/`course_end`, and a saved schedule stores
subject codes + commission **names** (`{"selectedCourses": [{"subject_id",
"selectedCommissions": ["A"]}]}`, written by the scheduler and the app), not
commission ids. Most subjects reuse the same names every term, so:

- A subject's current term = its commissions with `course_end >= today` and
  `course_start <= today + 14 days`, narrowed to the newest term with
  `CommissionTerms` (the rule `GET /v1/subjects` uses). A term synced months
  ahead is not current; the two weeks before classes start, the starting
  term is.
- Each schedule entry keeps the current-term commissions whose name it lists
  (no name or "any" = all of them); entries with no match are dropped.
- The schedule is current when at least one entry survives **and** its
  `payload_updated_at` (ART date) is no earlier than **60 days before the latest
  `course_start`** among the kept commissions. Students build next term's
  schedule in the weeks before it starts, and consecutive terms start ~4-5
  months apart, so last term's schedule (same names) is stale.
  `saved_schedules.payload_updated_at` (V46, backfilled from `updated_at`) only
  moves when the payload really changes, so renaming a schedule or making it
  primary does not make an old term's schedule look current.

**Voting from the email.** Each button links to the ItbaNews page
`${DIGEST_PUBLIC_BASE_URL}/correction?token=…&vote=confirm|reject`. The token
is `<userId>.<correctionId>.<expiresAtEpochSeconds>.<base64url HMAC>`, keyed
with `ContentHmac`'s `digest-correction-vote` purpose key (same derivation as
the unsubscribe key, its own label), valid `DIGEST_VOTE_TOKEN_TTL` (14 days).
It says who may vote on which correction until when; the vote itself is
never taken from the link. **Nothing changes on GET** (mail scanners follow
links): the page loads the correction with
`GET /v1/digests/correction-vote?token=` and only the button click POSTs
`{token, vote}`. The vote goes through `ScheduleCorrectionService.vote` as
the token's user, so one vote per user, the 3-confirm rule, the commission
lock and anonymity are exactly those of the in-app vote. A replay of the same
vote changes nothing; a different vote replaces the previous one (as in the
app); `previousVote` in the response says which case it was.

| Case | Response |
|---|---|
| Bad signature, malformed, unknown/deleted user | `400 INVALID_TOKEN` |
| Expired (genuine) token | `410 TOKEN_EXPIRED` |
| `vote` other than `confirm`/`reject` | `400 INVALID_VOTE` |
| Correction no longer exists | `404 CORRECTION_NOT_FOUND` |
| Not PENDING/APPLIED, or its commission ended (GET says `open: false`) | `409 CORRECTION_CLOSED` (POST) |
| User's email no longer on an allowed domain | `422 EMAIL_NOT_ALLOWED` |

Both endpoints are public, ignore the session cookie/Authorization header
(like unsubscribe) and are rate limited per IP
(`RATE_LIMIT_DIGEST_CORRECTION_VOTE_*`, 60/min).

**Sending.** "Send" (manual or auto) locks the issue, snapshots the
recipients into `digest_deliveries` (`pending`, one batch insert) and sets the
issue to `sending`. A background worker (on the task executor, never the
scheduler thread) then walks the pending rows. Delivery is **at-most-once**:

- *Claim, then send.* Before each SMTP call the row is claimed in its own
  committed transaction (`SELECT … FOR UPDATE SKIP LOCKED`, `status =
  'sending'`, `claimed_at`), so two workers never take the same row. The send
  then runs in a second transaction that holds a share lock on the issue row,
  re-checks the issue is still `sending`, calls SMTP and marks the row `sent`
  or `failed` (the update count is checked).
- *Crash = unknown outcome.* A row still `sending` after 5 minutes means the
  process died around the SMTP call and nobody knows whether the email left.
  At the start of each run it is marked `failed` with the error `unknown
  outcome (interrupted)` and is **never resent**.
- *Graceful shutdown.* `server.shutdown=graceful`, the task executor waits for
  termination and the worker stops taking new rows on context close, so a
  deploy finishes the email in flight (`stop_grace_period: 90s` in compose).
- Throttled: `DIGEST_SEND_INTERVAL` (1 s) between emails.
- Sending quota (see "Sending quota" below): every email goes through
  `MailSendService`. While the account is paused or out of quota the worker
  does not start at all (no SMTP until `resumeAt`); when the quota runs out
  mid-run it stops and a later tick resumes once capacity frees, so an
  issue with more recipients than the limit just finishes the next day(s).
- *Who a failure blames* (`EmailSendException.Kind`, from the SMTP reply):
  - `RECIPIENT` (4.1.x, 4.2.x such as `452 4.2.2 mailbox over quota`, 5.1.x,
    5.2.x, rejected addresses, malformed message): that row is `failed` and
    the run goes on.
  - `TRANSIENT` (any other 4.x.x): temporary and scoped to that delivery. It
    goes back to `pending` (`attempts` + 1, `last_error`), is tried again
    after at least 2 minutes and after 3 attempts becomes `failed`. It never
    stops the run or pauses the account, and fresh rows are taken first
    (`ORDER BY attempts, user_id`).
  - `TRANSPORT` (authentication, connection, timeouts, `421`, `4.7.x`
    throttling, unknown errors): the account is the problem. The run stops,
    the row goes back to `pending` without counting an attempt, and
    `MailSendService` pauses the account with exponential backoff.
  - `QUOTA` (`5.4.5`, Gmail's "daily sending limit exceeded"): like
    TRANSPORT, but the account is paused for 24h.
- Each delivery gets a random tracking id and its links rewritten right
  before sending (see "Open and click tracking").
- A claimed recipient who meanwhile unsubscribed, unfollowed CEITBA or is
  outside the allowed domains is dropped (row deleted).
- No pending row left → the issue is `sent` with `sent_at`.

**Mail disabled.** With `MAIL_ENABLED=false` nothing can be sent: `send` and
the test send answer `409 MAIL_DISABLED`, the auto-send tick logs and skips,
and the worker does nothing (issues stay as they are). The logging transport
exists only for local development with `MAIL_LOG_SENDS=true` (it reports
success without sending and logs masked addresses).

**Stopping a send ("Detener envío").** `POST /v1/digests/{id}/cancel` also
works while `sending`: it takes the issue row lock (so it waits for the email
in flight, if any), deletes the remaining `pending` deliveries and sets
`cancelled` (a row claimed but not yet sent is dropped by the worker). Already `sent`/`failed` rows stay, so counts show what went out.
The worker sees the new status before its next email and stops. Cancelling a
`sent` or `cancelled` issue is `409 DIGEST_NOT_EDITABLE`.

**Unsubscribe.** `user.digest_email_enabled` (default true) is separate from
following (follows also drive push notifications). Users toggle it with
`GET/PUT /v1/digests/subscription`: `enabled` is the real audience, i.e.
`digest_email_enabled` AND following `ceitba`; `PUT {enabled:true}` sets the
flag and follows CEITBA (idempotent), `PUT {enabled:false}` only clears the
flag. Every email has:
- a body link to `${DIGEST_PUBLIC_BASE_URL}/unsubscribe?token=…` (an
  ItbaNews page that calls the API), and
- `List-Unsubscribe: <${DIGEST_API_BASE_URL}/v1/digests/unsubscribe?token=…>`
  plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), so
  Gmail's "Unsubscribe" button POSTs straight to the API.

The token is `<userId>.<base64url HMAC-SHA256>` keyed with `ContentHmac`'s
`digest-unsubscribe` purpose key (derived from `CONTENT_HMAC_SECRET`, or
`AUTH_JWT_SECRET` when unset, with its own label — never the JWT signing key
itself). Tokens don't expire; rotating the root secret invalidates the links
in emails already sent. `POST /v1/digests/unsubscribe` is public, rate
limited per IP (`RATE_LIMIT_DIGEST_UNSUBSCRIBE_*`) and ignores the session
cookie.

Footer copy: "Recibís este resumen semanal porque seguís a CEITBA en ITBA
News. Medimos aperturas y clics para mejorar el resumen." plus the
unsubscribe link.

**Test sends** go to the caller's own email, ignore their opt-out but never
the domain guard (`422 EMAIL_NOT_ALLOWED`), have a `[Prueba]` subject
prefix, **consume sending quota** (`429 MAIL_QUOTA_EXHAUSTED` with
`resumeAt` and `Retry-After` when none is left, or while Gmail's daily-limit
pause lasts) and are **not tracked** (plain links, no pixel), so they never
show up in an issue's stats.

## Sending quota (Gmail limits)

Code: `service/mail/MailSendService` (the only `EmailSender` bean: the SMTP
or logging transport is wrapped inside it, so no caller can bypass it),
`MailLedger`/`JpaMailLedger`.

- **Ledger.** Every SMTP attempt, whoever makes it (digest deliveries, test
  sends, later the per-org emails), is a `mail_send_log` row: `account` (the
  From address, e.g. `ceitba@itba.edu.ar`), `kind` (`digest` | `test` | …),
  `recipients` (1 per message), `attempted_at`, `outcome` (`sent`,
  `rejected`, `quota`, `transient`) and the error. Rows are committed in
  their own transaction, so an email that left stays counted.
- **Rolling window.** `remaining = limit − used in the last 24h`, where
  `used` sums the recipients of the attempts that reached Gmail (`sent` and
  `rejected`; transport errors and Gmail's own limit error don't). With
  nothing remaining, nothing is sent: the next capacity frees when enough of
  the oldest attempts leave the window (the oldest attempt + 24h when
  exactly at the limit). The worker checks this before touching SMTP and
  waits until then; overflow rolls into the next day by itself.
- **Limit.** `MAIL_DAILY_LIMIT` (falls back to the older
  `DIGEST_DAILY_LIMIT`; default 1500, safely under Workspace's ~2000
  recipients per rolling 24h), per sending account; `mail.daily-limits`
  overrides it per address (yml only).
- **Gmail's own error is authoritative.** A `550 5.4.5 Daily user sending
  limit exceeded` (our count can be off, e.g. staff also send from the
  account by hand) pauses the account for `MAIL_QUOTA_PAUSE` (24h), or until
  the rolling-window estimate if that is later. The pause is persisted in
  `mail_account_state`, so it survives restarts; test sends get 429 during
  it.
- **Other transport errors** (`TRANSPORT`: auth, connection, timeouts, `421`,
  `4.7.x`) pause the background
  worker with exponential backoff, 5 min → 10 → 20 → 40 → 1 h cap
  (`MAIL_BACKOFF_INITIAL` / `MAIL_BACKOFF_MAX`), instead of retrying every
  tick. Also persisted. A manual test send still tries (to check whether SMTP
  is back); any successful send clears the backoff.
- **Recipient-scoped errors don't pause anything.** `RECIPIENT` (rejected
  address, mailbox over quota `4.2.2`) counts against the quota (it reached
  Gmail) and fails that delivery; `TRANSIENT` (other 4.x.x) is logged,
  not counted, and retried for that delivery only (3 attempts).
- **Domain guard.** `MailSendService` refuses `digest` and `test` emails to
  any address outside `DIGEST_ALLOWED_DOMAINS` (`RECIPIENT`, nothing sent or
  logged), whatever the caller checked.
- **Admin.** `GET /v1/digests/quota` → `{account, limit, usedLast24h,
  remaining, pausedUntil, pauseReason, nextCapacityAt}`. A `sending` issue
  in the list and detail carries `resumeAt` (while the account is paused or
  out of quota) and `estimatedFinishAt` (approximate: simulates the rolling
  window at the send pace; issues are sent oldest week first, so each
  estimate includes the pending emails of earlier sending issues).

## Open and click tracking

Code: `service/digest/DigestTrackingService`, `service/mail/MailLinkRewriter`,
`service/mail/MailClientClass`, `web/mail/MailTrackingController`.

- **Tracking id.** Each delivery gets a random 128-bit id
  (`digest_deliveries.tracking_id`, base64url, never the user id), set right
  before sending and kept across retries.
- **Open pixel.** `<img src="${DIGEST_API_BASE_URL}/v1/mail/o/{trackingId}.gif"
  width="1" height="1" alt="">` at the end of the body.
  `GET /v1/mail/o/{trackingId}.gif` is public, always answers a 1×1
  transparent GIF with no-cache headers (unknown ids too) and records first
  and last open plus an open count.
- **Click redirects.** Every http(s) link of the HTML and plain-text parts —
  articles, events, wiki and correction-vote links of "Tu cuatrimestre", the
  scheduler call to action — becomes
  `${DIGEST_API_BASE_URL}/v1/mail/c/{trackingId}/{linkId}`. Two things are
  never wrapped: the `List-Unsubscribe` **header** and the unsubscribe link
  in the body (`${DIGEST_PUBLIC_BASE_URL}/unsubscribe…`), which must work
  even if tracking rows are missing, expired or the endpoint is limiting. In
  the plain-text part a URL ends before trailing `. , ; : ! ?` and an
  unbalanced `)`, which stay outside the link. `GET` answers a 302 to the
  original URL, resolved **only** from server-side data: the issue's shared
  links (`digest_issue_links`, ids < 1000, collected from the shared template)
  or the delivery's own links (`digest_delivery_links`, ids ≥ 1000:
  "Tu cuatrimestre", which carries per-reader tokens). Nothing
  is ever taken from the request, so it is not an open redirect; unknown
  ids go to `${DIGEST_PUBLIC_BASE_URL}`. A click implies an open.
- **Scanners and bots.** Events from known scanner/bot user agents (and
  `HEAD` requests), or within 10 s of the email being sent, are recorded in
  `mail_tracking_event` but flagged (`scanner` / `early`) and excluded from
  every stat and counter. No IP and no full user agent are stored, only a
  coarse client class (`gmail_proxy`, `yahoo_proxy`, `outlook`, `browser`,
  `scanner`, `unknown`).
- **Cheap and rate limited.** One indexed lookup, an insert and an update.
  Both endpoints always answer. The in-memory rate limiter runs **before any
  DB read**: per client address (600/min, keyed by an HMAC of the IP, never
  stored: Gmail's image proxy fetches for many readers from few addresses)
  and per tracking id (30/h). A refused request still gets its answer without
  touching the DB: the GIF for the pixel, and a redirect to
  `${DIGEST_PUBLIC_BASE_URL}` (the home, since the stored target is not
  looked up) for a click. They ignore the session cookie, like unsubscribe.
- **Opens are approximate; clicks are the reliable signal.** Gmail fetches
  images through its proxy and caches them, so repeat opens are mostly
  invisible (the first open is seen). Apple Mail Privacy Protection
  pre-fetches every image when the email arrives, so Apple Mail users look
  like they opened it (unless it falls inside the 10 s window). Clients that
  block images never report an open. A click is a person (minus scanners).
- **Privacy.** The admin shows aggregate numbers only, never who opened or
  clicked. The footer says "Medimos aperturas y clics para mejorar el
  resumen." The stored per-reader links include their tokens (the same ones
  the email carries); they are deleted with the delivery (issue or user
  deletion cascades). `DIGEST_TRACKING_ENABLED=false` turns the pixel and the
  rewriting off for future sends.
- **Stats.** `GET /v1/digests/{id}/stats` → `{delivered, uniqueOpens,
  openRate, uniqueClicks, clickRate, clicksByLink: [{label, url,
  uniqueClicks, totalClicks}], opensByHour: [{hour, count}]}`. Rates are over
  delivered (`sent`) emails, 0..1 (null with none). `clicksByLink` groups by
  the URL without its `token` parameter (so every "Sí, es así" link is one row) and `label` is the link text.
  `opensByHour` counts first (unique) opens per hour (ART). The issue list
  has `openRate`/`clickRate` per issue.

## API (STAFF unless noted)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/digests` | Newest week first, with `counts {pending,sent,failed}`, `openRate`, `clickRate`, and while sending `resumeAt` / `estimatedFinishAt` |
| GET | `/v1/digests/quota` | Sending quota of the account (see "Sending quota") |
| GET | `/v1/digests/{id}/stats` | Aggregate opens/clicks (see "Open and click tracking"); 404 unknown id |
| POST | `/v1/digests` | `{weekStart, autoSendAt?}` (Monday, else `400 INVALID_WEEK_START`; a past `autoSendAt` is `400 AUTO_SEND_IN_PAST`) → 201; `409 DIGEST_EXISTS` |
| GET | `/v1/digests/{id}` | Detail: all candidates with `excluded` flags, `recipientEstimate` (eligible recipients; draft only, else `null`), `resumeAt` / `estimatedFinishAt` while sending |
| PATCH | `/v1/digests/{id}` | Any of `subject, intro, excludedArticleIds, excludedEventIds, autoSendAt` (`null` intro clears, `null` autoSendAt disables, a changed one must be in the future: `400 AUTO_SEND_IN_PAST`); draft only (`409 DIGEST_NOT_EDITABLE`) |
| GET | `/v1/digests/{id}/preview` | `text/html`, as the caller would receive it (their own "Tu cuatrimestre"); `mode` is accepted and ignored |
| POST | `/v1/digests/{id}/test` | → `{sentTo}`; any status; `409 MAIL_DISABLED`; `429 MAIL_QUOTA_EXHAUSTED` `{…, resumeAt}` + `Retry-After` |
| POST | `/v1/digests/{id}/send` | → 202 detail (`sending`); draft only; `409 DIGEST_EMPTY` with nothing to send; `409 MAIL_DISABLED` |
| POST | `/v1/digests/{id}/cancel` | From `draft` or `sending` |
| GET/PUT | `/v1/digests/subscription` | Any signed-in user; `{enabled}` = flag AND follows `ceitba`; PUT true also follows CEITBA |
| POST | `/v1/digests/unsubscribe?token=` | Public; 204; `400 INVALID_TOKEN`; accepts the RFC 8058 form body |
| GET | `/v1/digests/correction-vote?token=` | Public; the correction (subject, commission, `proposed`/`sga` slots, `status`, `open`, counts, `myVote`, `expiresAt`); never writes |
| POST | `/v1/digests/correction-vote` | Public; `{token, vote: confirm\|reject}` → `{correction, previousVote}`; errors in the table above |
| GET | `/v1/mail/o/{trackingId}.gif` | Public open pixel; always a 1×1 GIF |
| GET | `/v1/mail/c/{trackingId}/{linkId}` | Public click redirect; 302 to the stored URL, else to `DIGEST_PUBLIC_BASE_URL` |

## Retention

A nightly job (03:40 ART, `MailRetentionJob`, off with `DIGEST_JOBS_ENABLED=
false`) keeps the bookkeeping bounded:

- `mail_tracking_event` rows older than `MAIL_RETENTION_TRACKING` (180 days)
  and the `digest_delivery_links` of deliveries sent that long ago (clicks on
  such old emails then land on the newsletter home; the shared issue links
  and the per-delivery counters `open_count`/`click_count`/... stay, so
  open and click rates survive, per-link click stats of old issues do not).
- `mail_send_log` rows older than `MAIL_RETENTION_SEND_LOG` (30 days). The
  sending quota only ever reads the last 24h (`MailSendService.WINDOW`), and
  the smallest accepted value is 2 days, so nothing that is deleted is read.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MAIL_ENABLED` | `false` | `false` = nothing can be sent (`409 MAIL_DISABLED`) |
| `MAIL_LOG_SENDS` | `false` | **Dev only.** With `MAIL_ENABLED=false`, log sends (masked addresses) and report success, so the flow can be tried locally |
| `MAIL_HOST` / `MAIL_PORT` | `smtp.gmail.com` / `587` | SMTP, STARTTLS required |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | _(empty)_ | `ceitba@itba.edu.ar` and its **app password**; required when enabled (startup fails otherwise) |
| `MAIL_FROM` | `CEITBA <ceitba@itba.edu.ar>` | From header (must be the account or an alias of it) |
| `DIGEST_PUBLIC_BASE_URL` | `https://ceitba.org.ar/newsletter` | Article, events, organizations and unsubscribe-page links |
| `DIGEST_API_BASE_URL` | `https://ceitba.org.ar/api` | `List-Unsubscribe` one-click target; open pixel and click redirect base |
| `DIGEST_ALLOWED_DOMAINS` | `itba.edu.ar` | **Hard guard**: digest emails (test sends included) only go to these domains |
| `MAIL_DAILY_LIMIT` | `DIGEST_DAILY_LIMIT`, else `1500` | Recipients per rolling 24h per sending account (all emails) |
| `MAIL_BACKOFF_INITIAL` / `MAIL_BACKOFF_MAX` | `PT5M` / `PT1H` | Backoff after transport errors (doubled per consecutive error) |
| `MAIL_QUOTA_PAUSE` | `PT24H` | Pause after Gmail's `5.4.5` daily-limit error |
| `DIGEST_TRACKING_ENABLED` | `true` | Open pixel + click redirects in sent issues |
| `MAIL_RETENTION_SEND_LOG` | `P30D` | Age after which `mail_send_log` rows are deleted (min `P2D`) |
| `MAIL_RETENTION_TRACKING` | `P180D` | Age after which tracking events and per-delivery link rows are deleted |
| `DIGEST_SEND_INTERVAL` | `PT1S` | Pause between emails |
| `DIGEST_TICK_INTERVAL` | `PT5M` | Auto-send check and resume of stalled sends |
| `DIGEST_JOBS_ENABLED` | `true` | Weekly draft + auto-send + worker (tests set `false`) |
| `DIGEST_WIKI_BASE_URL` | `https://ceitba.org.ar/apuntes` | CeitbaPage Apuntes reader (`/apuntes/:subjectId`, routes in `CeitbaPage/src/App.tsx`) |
| `DIGEST_SCHEDULER_URL` | `https://ceitba.org.ar/scheduler/` | "Armá tu horario" call to action |
| `DIGEST_VOTE_TOKEN_TTL` | `P14D` | Lifetime of the correction vote links |
| `DIGEST_MAX_WIKI_LINKS` / `DIGEST_MAX_CORRECTIONS` | `5` / `3` | Caps per email (`0` hides that part) |

The transport is behind `service/mail/EmailSender`; switching to another
provider (e.g. the Gmail API with OAuth) later means one new implementation
in `MailConfig`. Sending as other identities (each org's own account) would
add a sender identity to `OutgoingEmail`; callers stay the same.
Spring Boot's mail health check is disabled so SMTP trouble never marks the
API down.

## Gmail / Workspace setup (one-time)

We have no DNS access for itba.edu.ar, so the digest goes out through the
`ceitba@itba.edu.ar` Google Workspace account itself (SPF/DKIM are ITBA's).

1. Sign in as `ceitba@itba.edu.ar` → <https://myaccount.google.com/security>
   → turn on **2-Step Verification** (app passwords require it).
2. **The ITBA Workspace admin must allow app passwords / "less secure" SMTP
   AUTH** for the account's org unit. If the "App passwords" page says the
   setting is not available for the account, ask ITBA IT to enable it (Admin
   console → Security → Authentication → 2-Step Verification, and Security →
   Less secure apps / app passwords).
3. <https://myaccount.google.com/apppasswords> → create one named
   "CEITBA API" → copy the 16 characters (no spaces) into `MAIL_PASSWORD` on
   the VPS `.env`, with `MAIL_USERNAME=ceitba@itba.edu.ar`.
4. Set `MAIL_ENABLED=true`, `docker compose up -d ceitba-api`, then use
   "Enviar prueba" in the admin to check delivery before the first Monday.
5. Changing the account password revokes app passwords: create a new one.

**Limits.** Workspace allows about **2000 recipients per day** per user
(rolling 24h, the exact cap depends on the plan) and fewer for new or
trial-like accounts; hitting it returns `550 5.4.5 Daily user sending limit
exceeded` and blocks the account's sending for up to 24h — including the
staff's normal email from it. `MAIL_DAILY_LIMIT=1500` leaves headroom for
that; with more recipients than the limit the issue simply finishes the next
day. If Gmail still answers 5.4.5, the account is paused 24h (see "Sending
quota"). Gmail also throttles bursts, hence the 1 email/s pace.
