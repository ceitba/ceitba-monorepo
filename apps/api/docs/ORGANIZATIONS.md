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
