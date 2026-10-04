# Weekly digest email — "La semana en ITBA"

Every Monday CEITBA emails its followers one digest of the whole newsletter:
everything published last week (every organization, plus independent
articles) and every event of the coming week. The content is the same for
every recipient. Staff review, edit and send it from the ItbaNews admin area.

Code: `service/digest/*` (selection, rendering, lifecycle, sending worker),
`service/mail/*` (transport), `scheduling/DigestJob`, `web/digest/DigestController`.
Schema: `V45__weekly_digest.sql`.

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
(`DigestRenderer.template`); per recipient only the unsubscribe link and an
optional per-reader block are spliced in. That block comes from the
`DigestPersonalSection` extension point (placed between the content and the
footer); the default bean returns nothing. It is meant for a future
"Tu cuatrimestre" section.

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
- Rolling quota: at most `DIGEST_DAILY_LIMIT` send attempts (sent + failed,
  by `sent_at`) in the last 24h across all issues. When it is used up the
  run stops; a later tick continues.
- *Who a failure blames* (`EmailSendException.Kind`, from the SMTP reply):
  - `RECIPIENT` (4.1.x, 4.2.x such as `452 4.2.2 mailbox over quota`, 5.1.x,
    5.2.x, rejected addresses, malformed message): that row is `failed` and
    the run goes on.
  - `TRANSIENT` (any other 4.x.x): temporary and scoped to that delivery. It
    goes back to `pending` (`attempts` + 1, `last_error`), is tried again
    after at least 2 minutes and after 3 attempts becomes `failed`. It never
    stops the run, and fresh rows are taken first (`ORDER BY attempts,
    user_id`).
  - `TRANSPORT` (authentication, connection, timeouts, `421`, `5.4.5` Gmail
    daily limit, `4.7.x` throttling, unknown errors): the account is the
    problem. The run stops, the row goes back to `pending` without counting
    an attempt, the next tick retries.
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
News." plus the unsubscribe link.

**Test sends** go to the caller's own email, ignore their opt-out but never
the domain guard (`422 EMAIL_NOT_ALLOWED`), have a `[Prueba]` subject prefix
and are not counted in the quota.

## API (STAFF unless noted)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/digests` | Newest week first, with `counts {pending,sent,failed}` |
| POST | `/v1/digests` | `{weekStart, autoSendAt?}` (Monday, else `400 INVALID_WEEK_START`; a past `autoSendAt` is `400 AUTO_SEND_IN_PAST`) → 201; `409 DIGEST_EXISTS` |
| GET | `/v1/digests/{id}` | Detail: all candidates with `excluded` flags, `recipientEstimate` (eligible recipients; draft only, else `null`) |
| PATCH | `/v1/digests/{id}` | Any of `subject, intro, excludedArticleIds, excludedEventIds, autoSendAt` (`null` intro clears, `null` autoSendAt disables, a changed one must be in the future: `400 AUTO_SEND_IN_PAST`); draft only (`409 DIGEST_NOT_EDITABLE`) |
| GET | `/v1/digests/{id}/preview` | `text/html`, as the caller would receive it; `mode` is accepted and ignored |
| POST | `/v1/digests/{id}/test` | → `{sentTo}`; any status; `409 MAIL_DISABLED` |
| POST | `/v1/digests/{id}/send` | → 202 detail (`sending`); draft only; `409 DIGEST_EMPTY` with nothing to send; `409 MAIL_DISABLED` |
| POST | `/v1/digests/{id}/cancel` | From `draft` or `sending` |
| GET/PUT | `/v1/digests/subscription` | Any signed-in user; `{enabled}` = flag AND follows `ceitba`; PUT true also follows CEITBA |
| POST | `/v1/digests/unsubscribe?token=` | Public; 204; `400 INVALID_TOKEN`; accepts the RFC 8058 form body |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MAIL_ENABLED` | `false` | `false` = nothing can be sent (`409 MAIL_DISABLED`) |
| `MAIL_LOG_SENDS` | `false` | **Dev only.** With `MAIL_ENABLED=false`, log sends (masked addresses) and report success, so the flow can be tried locally |
| `MAIL_HOST` / `MAIL_PORT` | `smtp.gmail.com` / `587` | SMTP, STARTTLS required |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | _(empty)_ | `ceitba@itba.edu.ar` and its **app password**; required when enabled (startup fails otherwise) |
| `MAIL_FROM` | `CEITBA <ceitba@itba.edu.ar>` | From header (must be the account or an alias of it) |
| `DIGEST_PUBLIC_BASE_URL` | `https://ceitba.org.ar/newsletter` | Article, events, organizations and unsubscribe-page links |
| `DIGEST_API_BASE_URL` | `https://ceitba.org.ar/api` | `List-Unsubscribe` one-click target |
| `DIGEST_ALLOWED_DOMAINS` | `itba.edu.ar` | **Hard guard**: digest emails (test sends included) only go to these domains |
| `DIGEST_DAILY_LIMIT` | `1500` | Send attempts per rolling 24h |
| `DIGEST_SEND_INTERVAL` | `PT1S` | Pause between emails |
| `DIGEST_TICK_INTERVAL` | `PT5M` | Auto-send check and resume of stalled sends |
| `DIGEST_JOBS_ENABLED` | `true` | Weekly draft + auto-send + worker (tests set `false`) |

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
staff's normal email from it. `DIGEST_DAILY_LIMIT=1500` leaves headroom for
that; with more recipients than the limit the issue simply finishes the next
day. Gmail also throttles bursts, hence the 1 email/s pace.
