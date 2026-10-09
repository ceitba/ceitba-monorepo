# Organizations

Student organizations publish articles and events in the newsletter, keep a public portal
(`/newsletter/organizations/<slug>`) and manage their own members, so they don't need CEITBA staff for day-to-day
work or for the yearly board change.

## Roles

Membership lives in `user_organizations` (`role` is `member` or `admin`). STAFF can do everything below for any org.

| Action | member | admin |
|---|---|---|
| Write, edit and publish the org's articles and events | yes | yes |
| Delete the org's articles and events | yes | yes |
| Edit the profile (description, colors, images, contact, recruiting); name and full name stay STAFF-only in the UI | yes | yes |
| Upload org images (`POST /v1/organizations/{slug}/media/sign-upload`) | yes | yes |
| See followers (names and emails) | | yes |
| List members and invites, invite, change roles and board titles, remove members, hand over admin | | yes |
| Leave the org (`DELETE /v1/organizations/{slug}/members/me`) | yes | yes |

Checks are `@orgAccess.*` SpEL helpers (`web/news/OrgAccess`) next to the `hasRole('STAFF')` escape hatch. Deletes
re-check membership under the row lock (`ArticleService.deleteAsOrgMember`, `NewsEventService.delete`), so an
item that moved to another org after the check is refused with 409.

## Members API

`/v1/organizations/{slug}/members` (`OrgMembersController`), org admins and STAFF:

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
  provisioned (`UserProvisioningService.findOrCreate`, new-user branch), `claimInvites` turns its invites into
  memberships (`INSERT … SELECT … ON CONFLICT DO NOTHING`) and deletes them.

Account deletion removes the pending invites of the user's email, like capability grants.

### Last admin

Once an org has an admin it keeps one: demoting or removing the last admin, leaving as the last admin, and
deleting the account of the last admin of any org answer **409 `LastOrgAdmin`**. The check locks the org's admin
rows (`UserOrganizationRepository.findAdminsForUpdate`), so two admins stepping down at once serialize. STAFF
skips the check for removals and role changes (an org nobody runs any more), but not for account deletion. Orgs
that never had an admin are unaffected; STAFF names the first one.

## Profile

`organizations` (V54) adds `instagram` (bare handle, normalized with `SocialHandles.instagram`; the API accepts a
handle, `@handle` or profile URL), `linkedin_url`, `website_url` and `recruiting_url` (http(s) only),
`contact_email`, `recruiting_open` and `recruiting_text` (≤280). In a PATCH, null leaves a field and blank clears
it.

`GET /v1/organizations/{slug}` also returns `board`: `[{name, title, avatarUrl}]` for members with
`show_on_portal`, oldest membership first, never emails. Lists return `board: null`.

## Images

`POST /v1/organizations/{slug}/media/sign-upload` signs a presigned PUT (see OBJECT-STORAGE.md) for any member:
jpeg, png or webp up to 5 MB, key `orgs/{slug}/{uuid}.{ext}`, rate-limited per user by
`rate-limit.user-rules.org-images` (`RATE_LIMIT_ORG_IMAGES_CAPACITY`/`_PERIOD`, default 60 per hour). The web
app uses it for the logo, the portal background and article covers/inline images of the org's articles.

## Events: sign-up, reminders, calendar

`news_events` (V55) adds `cover_image`, `online_url` and the sign-up: `signup_mode` is `none`, `external`
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

**Reminders.** `EventReminderJob` runs hourly 18:00–23:00 ART (`EVENT_REMINDERS_ENABLED`, default true; off in
tests). `EventReminderService` claims each RSVP event of tomorrow with a conditional
`UPDATE … SET reminder_sent_at WHERE reminder_sent_at IS NULL`, then pushes "Mañana a las HH:mm · lugar" to the
RSVPs' devices (`PushToUsers`). The later runs only catch what a restart missed. Users without the mobile app get no
reminder.

**Views.** The event page sends `event_view` analytics events with `eventId` (`analytics_events.event_id`).

**Web.** `/newsletter/events/:id` shows the event with the sign-up block and add-to-calendar (Google Calendar link
and an `.ics` download built by `apps/web/src/utils/ics.ts`, shared with the scheduler). The org's members see RSVP
counts in Mis publicaciones → Eventos and the list (with CSV export) at `/newsletter/mine/events/:id/attendees`.

## Stats

`GET /v1/organizations/{slug}/analytics?days=30` (members and STAFF; `days` 1–365, the last N ART calendar days
including today) → `OrgAnalyticsService.OrgAnalytics`:

- `articleViews`, `eventViews`, `uniqueVisitors` (distinct browser sessions) and `daily` (per day, zero-filled),
  counted toward the article's or event's *current* organization;
- `topArticles` (10) and `events` (the org's events dated in the window or later, with views and RSVPs);
- `followers`: `total`, `newInPeriod` and `cumulative`, the current followers by the day they followed (unfollows
  are not recorded, so it is not a net-growth curve);
- `pushes`: fan-outs and devices targeted/reached from `push_log` (V56). `PushTriggerListener` writes one row per
  fan-out with the message's `org` data key (`PushToOrgFollowers` always; event reminders carry it too).

The web page is `/newsletter/mine/org/:slug/stats` (Estadísticas), built from the same CSS charts as the staff
analytics (`newsletter/components/admin/charts.tsx`).
