# Object storage (Cloudflare R2)

The API never receives file bytes. It signs short-lived presigned `PUT` URLs
(`R2_PRESIGN_TTL`, default 10 min) and the client uploads straight to the
bucket (`service/media/MediaUploadService`). Configuration is in
`.env.example` (`R2_*`); any empty value disables uploads (the sign endpoints
answer `501`).

## Key layout

| Prefix | Written by | Referenced from |
|---|---|---|
| `media/{uuid}.{ext}` | `POST /v1/media/sign-upload` (STAFF CMS images) | article, benefit and highlight image URLs |
| `proposals/{uuid}-{tag}.{ext}` | `POST /v1/proposals/attachments/sign-upload` | `proposal_attachment.object_key` |
| `proposals/legacy/{uuid}.{ext}` | `scripts/firestore-export --copy-attachments` | `proposal_attachment.object_key` (imported proposals) |

`{tag}` binds a proposal attachment key to its uploader without revealing or
linking them; see the header of `MediaUploadService`.

## Orphaned uploads

Signing an upload does not create any row. An object becomes referenced only
when the client then creates the proposal (or saves the CMS entity) with its
key. If the client uploads and never submits, the object stays in the bucket
with nothing pointing at it. Proposal attachments are the main source: every
signed-in user can sign up to `RATE_LIMIT_PROPOSAL_ATTACHMENTS_CAPACITY` uploads
per period.

Nothing in the API deletes these today. Clean them up with R2 lifecycle rules
(bucket -> **Settings** -> **Object lifecycle rules**):

1. **Abort incomplete multipart uploads after 1 day** (all prefixes). The
   presigned uploads are single `PUT`s, so this only removes leftovers of
   manual or tool uploads. It is safe to enable now.
2. **Do not add an age-based delete rule on `proposals/` or `media/`.** R2
   lifecycle rules match by prefix and age only. They cannot tell a referenced
   object from an orphan, so such a rule would also delete the attachments of
   live proposals.

To expire orphans with a lifecycle rule alone, uploads would have to land
under a staging prefix, for example `proposals/pending/`, with a rule such
as "delete objects under `proposals/pending/` after 1 day". Proposal create
would then copy each object to its final key. This needs code changes in
`MediaUploadService` and `ProposalService` and is not implemented yet
(follow-up).

Until then, orphans can be listed and removed by hand. Take the keys under
`proposals/` that are not `proposals/legacy/`, whose last-modified time is
older than a day, and that are not in:

```sql
SELECT object_key FROM public.proposal_attachment;
```

Delete those keys with an R2 token scoped to the bucket. The volume is bounded
by the per-user signing quota.
