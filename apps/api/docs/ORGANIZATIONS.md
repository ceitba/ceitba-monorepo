# Organizations

Student organizations publish articles and events in the newsletter, keep a public portal
(`/newsletter/organizations/<slug>`) and manage their own members, so they don't need CEITBA staff for day-to-day
work or for the yearly board change.

## Roles

Membership lives in `user_organizations` (`role` is `member` or `admin`). STAFF can do everything below for any org.

| Action | member | admin |
|---|---|---|
| Write, edit and publish the org's articles and events | yes | yes |
| See events' RSVP lists (names, emails) | unless the admins turn it off | yes |
| Delete the org's articles and events | yes | yes |
| Edit the profile (description, colors, images, contact, recruiting); name and full name stay STAFF-only in the UI | yes | yes |
| Upload org images (`POST /v1/organizations/{slug}/media/sign-upload`) | yes | yes |
| See followers (names and emails) | | yes |
| List members and invites, invite, change roles and board titles, remove members, hand over admin | | yes |
| Leave the org (`DELETE /v1/organizations/{slug}/members/me`) | yes | yes |

Checks are `orgAccess.*` named checks (`OrgAccess` in `src/features/news/access.ts`, referenced by the METHOD_RULES of
`src/http/auth/policy.ts`) next to the `role('STAFF')` escape hatch. Deletes
re-check membership under the row lock (`ArticleService.deleteAsOrgMember` in `src/features/news/articles.ts`,
`NewsEventService.delete` in `src/features/news/events.ts`), so an
item that moved to another org after the check is refused with 409.

## Members API

`/v1/organizations/{slug}/members` (`src/features/news/routes.ts`), org admins and STAFF:

| Method | Path | |
|---|---|---|
| GET | `` | `{members: [{userId, name, email, avatarUrl, role, title, showOnPortal, since}], invites: [{email, role, createdAt}]}` |
| POST | `/invites` | `{emails: [..≤50], role?}` → `{added: [member], pending: [invite]}` |
| DELETE | `/invites?email=` | revoke a pending invite (404 if none) |
| PATCH | `/{userId}` | `{role?, title?, showOnPortal?}` → member; null leaves a field, a blank title clears it |
| DELETE | `/{userId}` | remove (idempotent) |
| POST | `/{userId}/transfer-admin` | the calling admin makes `userId` admin and becomes a member (one transaction) |
| DELETE | `/me` | any member leaves |

The STAFF-only `/v1/users/{userId}/organizations` endpoints (ManageUsersSection) keep working.

### Invites

Each invited email is lowercased and must pass the login allowlist (`AUTH_ALLOWED_DOMAINS` ∪
`AUTH_ALLOWED_EMAILS`, 400 otherwise): an email that can't sign in could never claim the invite.

- An email that already has a `user` row is added at once (`added_by` = the inviter) and gets a push
  (`PushToUsers`, data `type=organization`, `id=<slug>`). Already-members are skipped.
- Any other email is upserted into `org_invites` (re-inviting only updates the role). When that email is first
  provisioned (`findOrCreateUser` in `src/http/auth/provisioning.ts`, new-user branch), `claimInvites` turns its invites into
  memberships (`INSERT … SELECT … ON CONFLICT DO NOTHING`) and deletes them.

Account deletion removes the pending invites of the user's email, like capability grants.

### Last admin

Once an org has an admin it keeps one: demoting or removing the last admin, leaving as the last admin, and
deleting the account of the last admin of any org answer **409 `LastOrgAdmin`**. The check locks the org's admin
rows (`findAdminsForUpdate` in `src/features/news/repo.ts`, and its copy in `src/features/user/repo.ts` for account deletion), so two admins stepping down at once serialize. STAFF
skips the check for removals and role changes (an org nobody runs any more), but not for account deletion. Orgs
that never had an admin are unaffected; STAFF names the first one.

## Profile

`organizations` (V55) adds `instagram` (bare handle, normalized by `src/features/user/logic/socialHandles.ts`; the API accepts a
handle, `@handle` or profile URL), `linkedin_url`, `website_url` and `recruiting_url` (http(s) only),
`contact_email`, `recruiting_open` and `recruiting_text` (≤280). In a PATCH, null leaves a field and blank clears
it.

`GET /v1/organizations/{slug}` also returns `board`: `[{name, title, avatarUrl}]` for members with
`show_on_portal`, oldest membership first, never emails. Lists return `board: null`.

## Images

`POST /v1/organizations/{slug}/media/sign-upload` signs a presigned PUT (see OBJECT-STORAGE.md) for any member:
jpeg, png or webp up to 5 MB, key `orgs/{slug}/{uuid}.{ext}`, rate-limited per user by
the `org-images` user rule in `src/config/sections/rateLimit.ts` (`RATE_LIMIT_ORG_IMAGES_CAPACITY`/`_PERIOD`, default 60 per hour). The web
app uses it for the logo, the portal background and article covers/inline images of the org's articles.

## Events: sign-up, reminders, calendar

`news_events` (V56) adds `cover_image`, `online_url` and the sign-up: `signup_mode` is `none`, `external`
(`signup_url` required, e.g. a Google Form) or `rsvp` (built-in, optional `capacity`). In a PATCH the sign-up is
replaced as a whole only when `signupMode` is sent (`signupUrl`/`capacity` are then taken as sent, null clearing
them); `coverImage`/`onlineUrl` follow null-leaves, blank-clears. Responses carry `rsvpCount`.

| Method | Path | Who | |
|---|---|---|---|
| POST | `/v1/news/events/{id}/rsvp` | signed-in user | → `{going: true, rsvpCount}`; idempotent |
| DELETE | `/v1/news/events/{id}/rsvp` | signed-in user | → `{going: false, rsvpCount}`; idempotent |
| GET | `/v1/news/events/{id}/attendees` | members of the event's org, STAFF | `{data: [{userId, name, email, createdAt}]}` |
| GET | `/v1/me/rsvps` | signed-in user | `{eventIds}` |

RSVP answers 409 `EventNotRsvp` (another mode), `EventEnded` (the date is before today in ART) or `EventFull`. The
capacity check runs under the event's row lock, so the last seat can't be taken twice. Both RSVP methods share the
votes' per-IP rate limit (rule `event-rsvp`).

**Reminders.** `EventReminderJob` (`src/features/news/jobs.ts`) runs hourly 18:00–23:00 ART (`EVENT_REMINDERS_ENABLED`, default true; off in
tests). `EventReminderService` (`src/features/news/events.ts`) claims each RSVP event of tomorrow with a conditional
`UPDATE … SET reminder_sent_at WHERE reminder_sent_at IS NULL`, then pushes "Mañana a las HH:mm · lugar" to the
RSVPs' devices (`PushToUsers`). The later runs only catch what a restart missed. Users without the mobile app get no
reminder.

**Views.** The event page sends `event_view` analytics events with `eventId` (`analytics_events.event_id`).

**Web.** `/newsletter/events/:id` shows the event with the sign-up block and add-to-calendar (Google Calendar link
and an `.ics` download built by `apps/web/src/utils/ics.ts`, shared with the scheduler). The org's members see RSVP
counts in Mis publicaciones → Eventos and the list (with CSV export) at `/newsletter/mine/events/:id/attendees`.

## Stats

`GET /v1/organizations/{slug}/analytics?days=30` (members and STAFF; `days` 1–365, the last N ART calendar days
including today) → `OrgAnalytics` (`src/features/news/organizations.ts`):

- `articleViews`, `eventViews`, `uniqueVisitors` (distinct browser sessions) and `daily` (per day, zero-filled),
  counted toward the article's or event's *current* organization;
- `topArticles` (10) and `events` (the org's events dated in the window or later, with views and RSVPs);
- `followers`: `total`, `newInPeriod` and `cumulative`, the current followers by the day they followed (unfollows
  are not recorded, so it is not a net-growth curve);
- `pushes`: fan-outs and devices targeted/reached from `push_log` (V57). `firePush` (`src/features/push/service.ts`) writes one row per
  fan-out with the message's `org` data key (`PushToOrgFollowers` always; event reminders carry it too).

The web page is `/newsletter/mine/org/:slug/stats` (Estadísticas), built from the same CSS charts as the staff
analytics (`newsletter/components/admin/charts.tsx`).

## Email to followers

An org's admins email its followers from the org's **own Gmail account** (`mail_sender_account`, owner type
`organization`, owner ref = slug). The Google Cloud setup is the digest's (WEEKLY-DIGEST.md: Internal consent
screen on the itba.edu.ar Workspace, `gmail.send` scope, the same `GOOGLE_MAIL_REDIRECT_URI`), so the account must
be an `@itba.edu.ar` one (`ORG_MAIL_ALLOWED_DOMAIN`).

**Connecting.** `POST /v1/organizations/{slug}/mail/connect` (the org's own admin) returns Google's consent URL
with `hd=<allowed domain>` and no login hint; the signed OAuth state carries the slug, and the response sets the
`ceitba_mail_oauth_nonce` cookie that binds the state to this browser (a consent URL opened in another browser ends
in `invalid_state`). The shared callback
(`/v1/mail/accounts/oauth/callback`) then requires the user to still be an admin of the org and a verified address
of the allowed domain that no other owner uses, stores the encrypted refresh token (one account per org;
reconnecting with another address replaces it) and redirects to `/newsletter/mine/org/{slug}/mail` with
`?mail=connected` or `?mail=error&reason=` `not_org_admin | wrong_domain | account_in_use | missing_scope |
no_refresh_token | access_denied | invalid_state | exchange_failed`. `DELETE /v1/organizations/{slug}/mail`
revokes and removes it; deleting the org does too.

**Sending.** Each org account gets its own `MailSendService` (`OrgMailSenders` in `src/features/mail/service.ts`): its own rolling-24h quota in
`mail_send_log` (`ORG_MAIL_DAILY_LIMIT`, default 400), lock and pause, with the
org's name in From. The transport follows `MAIL_ENABLED`/`MAIL_TRANSPORT` (log-only in dev); with SMTP orgs can't
send. Org emails (kind `org`) are refused outside `DIGEST_ALLOWED_DOMAINS`, like the digest's.

| Method | Path (`/v1/organizations/{slug}`…) | |
|---|---|---|
| GET | `/mail` | account, quota, `weeklyLimit`/`sentThisWeek`, `recipientEstimate` |
| GET / POST | `/announcements` | list (50 latest, with sent/failed/pending counts) / create a draft `{subject, body}` |
| PATCH / DELETE | `/announcements/{id}` | drafts only (409 `OrgMailNotDraft`) |
| POST | `/announcements/{id}/test` | the draft to the caller, `[Prueba] …` |
| POST | `/announcements/{id}/send` | snapshot the recipients and start sending |

All are for the org's admins and STAFF. Send answers 409 `OrgMailNotConnected`, `MailDisabled`,
`OrgMailWeeklyLimit` (`ORG_MAIL_WEEKLY_LIMIT`, default 3 per rolling 7 days) or `OrgMailNoRecipients`.
Recipients are the org's followers who haven't opted out, within the allowed domains; each is re-checked right
before its email. `OrgAnnouncementSender` (`src/features/orgmail/sender.ts`) works through the deliveries exactly like the digest's worker (claim with
`SKIP LOCKED`, at most once, `TRANSIENT` retried 3 times, quota/transport problems pause until a later tick), woken
after commit and every `ORG_MAIL_TICK_INTERVAL` (PT2M) by `OrgMailJob` (`src/features/orgmail/jobs.ts`, `ORG_MAIL_JOBS_ENABLED`).

The body is plain text (≤ 20 000 chars): escaped, blank lines start paragraphs, http(s) URLs become links; no
HTML, attachments or open/click tracking. `Reply-To` is the org's contact email when set. Delivery rows are deleted
with the digest's tracking data (`MAIL_RETENTION_TRACKING_EVENTS`, 180 days after the email finished).

**Opting out.** Every email has `List-Unsubscribe` (one-click, RFC 8058) to the public
`POST /v1/org-mail/unsubscribe?token=` and a footer link to `/newsletter/unsubscribe?kind=org&token=`. The token
(`<userId>.<slug>.<HMAC>`, `ContentHmac` purpose `org-mail-unsubscribe`, `src/features/crypto/logic/contentHmac.ts`) only opts that user out of that org
(`org_mail_optouts`, which survives unfollowing). A follower switches an org's emails on and off with
`GET`/`PUT /v1/me/follows/{slug}/mail` `{enabled}` (the portal shows the switch). The stats count announcements
and recipients (`mail`).

## Member settings

`PATCH /v1/organizations/{slug}/members/settings` `{attendeesVisibleToMembers}` (org admins, STAFF; also returned as
`settings` by `GET …/members`). `attendees_visible_to_members` (V59, default true) decides whether plain members see
events' RSVP lists; admins and STAFF always do.
