# Newsletter comments and polls

Readers can comment on published newsletter articles, and authors can embed polls in an article's body. Code:
`src/features/engagement/` (API), `apps/web/src/newsletter/components/engagement/` (web). Tables from V68.

## Who can do what

| Action | Anonymous | Signed in (USER) | Article editor | STAFF |
|---|---|---|---|---|
| Read comments and polls of a published article | yes | yes | yes | yes |
| Comment, reply, like, report; vote in a poll | | yes | yes | yes |
| Delete own comment | | yes | yes | yes |
| Delete any comment, pin, restore a hidden comment, turn comments on/off | | | yes | yes |
| Create, edit, close and delete polls; always see poll results | | | yes | yes |

**Article editor** = a member of the article's organization (`OrganizationMembershipService.userBelongsTo`), or, for an
independent article (no organization), its creator while it is still unpublished (polls only). STAFF comes from
`staffPowers(c)`, so an API key without the `staff` scope is not STAFF here. The moderation routes (settings, pin,
restore) and the poll writes have `METHOD_RULES` in `policy.ts` (`orgAccess.canWriteForArticle`, plus
`orgAccess.canEditOwnIndependentArticle` for polls), so other callers get the empty 403 before binding; the services
check the same rules again inside their transaction. The public reads are covered by the existing `GET /v1/articles/**`
rule. A draft (non-published) article answers 404 on every route below to anyone who can't read
its drafts (the same rule as `GET /v1/articles/{id}`).

## Comments

`article_comments`: one level of replies (`parent_id` must point to a top-level comment of the same article, otherwise
400). Bodies are plain text, trimmed, 1–1000 characters after trimming, never rendered as Markdown. Comments cannot be edited.

- **Author.** Always the person (their `user` name and avatar). When the author is a member of the article's
  organization at read time, the comment carries `authorRole: "author"` (the web shows an "Autor" badge).
- **Delete** is a soft delete (`deleted_at`): a deleted comment with replies stays in the thread as a tombstone
  (`deleted: true`, empty body, no author); one without replies is left out of the list.
- **Likes**: one per user (`article_comment_likes`), `PUT`/`DELETE` are idempotent.
- **Reports**: one per user (`article_comment_reports`, re-reporting replaces the reason); nobody reports their own
  comment (400). At **3** reports a comment is hidden (`hidden_at`): left out for readers together with its replies,
  shown to editors and STAFF with `hidden: true`. Restore clears `hidden_at` and deletes its reports.
- **Pin**: editors pin one top-level comment per article (pinning another unpins the previous one). Pinned first,
  then by `sort`: `top` (likes, then newest; default) or `new` (newest). Replies are always oldest first.
- **On/off**: `articles.comments_enabled` (default true). Turned off, existing comments stay readable and new
  comments, replies and likes answer 409 `CommentsDisabled`.

### Routes (`src/features/engagement/routes.ts`)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v1/articles/{id}/comments?sort=top\|new` | | `CommentThreadResponse` |
| POST | `/v1/articles/{id}/comments` | `{body, parentId?}` | 201 `CommentResponse` |
| DELETE | `/v1/articles/{id}/comments/{commentId}` | | 204 |
| PUT / DELETE | `/v1/articles/{id}/comments/{commentId}/like` | | `{likes, likedByMe}` |
| PUT | `/v1/articles/{id}/comments/{commentId}/report` | `{reason?}` (≤500) | 204 |
| PUT | `/v1/articles/{id}/comments/{commentId}/pin` | `{pinned}` | `CommentResponse` |
| POST | `/v1/articles/{id}/comments/{commentId}/restore` | | `CommentResponse` |
| PUT | `/v1/articles/{id}/comments/settings` | `{enabled}` | `{enabled}` |

`CommentThreadResponse`: `{enabled, canModerate, total, comments: [CommentResponse]}`, where `total` counts the
non-deleted comments and replies the caller sees (editors also see hidden ones). `CommentResponse`: `{id, parentId, authorName, authorAvatarUrl, authorRole,
body, createdAt, likes, likedByMe, mine, pinned, deleted, hidden, replies}` (`replies` is `[]` on replies).

## Polls

A poll belongs to one article (`article_polls`, `article_poll_options`, `article_poll_votes`) and has 2–6 options
(each 1–120 characters; question 1–300). Single choice: one vote per user per poll, changeable or removable while the
poll is open. A poll is **closed** when `closes_at` ≤ now (`deps.clock`); "close now" sets `closes_at` to now. Votes on
a closed poll answer 409 `PollClosed`; `reopen` clears `closes_at`. Once a poll has votes its options can't change (409 `PollHasVotes`); the
question, visibility and closing time still can.

**Results visibility** (`results_visibility`), chosen by the author: `after_vote` (default; counts show once the caller
has voted, or the poll is closed) or `after_close` (only when closed). Editors and STAFF always see them. When hidden,
the API leaves the counts out (`votes: null` on each option, `totalVotes: null`): the browser never receives them.

**Placement in the body.** The editor inserts a fenced block whose content is the poll id:

````markdown
```poll
6f1c…-uuid
```
````

`ArticleBody` renders the fence as the poll; a fence whose id is not a poll of that article renders "Encuesta no
disponible". Readers that show the raw Markdown (the MCP `get_article` tool) see the fence. Removing the fence does not
delete the poll; the editor lists the article's polls and deletes them explicitly. Polls are created once the article
exists (saved at least once).

**Web.** The article editor's "Comentarios y encuestas" card (`EngagementSettings`) turns comments on/off and
creates polls; "Crear e insertar" / "Insertar en el texto" put the fence at the cursor, and the editor shows the
poll in place of the fence (`CodeBlockView`). `ArticleBody` renders fences as `PollBlock` when given the article id
(the public page and the editor preview, where polls show without voting); `CommentsSection` sits under the
article's 👍/👎 bar.

### Routes

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v1/articles/{id}/polls` | | `[PollResponse]` (oldest first) |
| GET | `/v1/articles/{id}/polls/{pollId}` | | `PollResponse` |
| POST | `/v1/articles/{id}/polls` | `{question, options: [label], resultsVisibility?, closesAt?}` | 201 `PollResponse` |
| PATCH | `/v1/articles/{id}/polls/{pollId}` | `{question?, options?, resultsVisibility?, closesAt?, close?, reopen?}` | `PollResponse` |
| DELETE | `/v1/articles/{id}/polls/{pollId}` | | 204 |
| PUT | `/v1/articles/{id}/polls/{pollId}/vote` | `{optionId}` | `PollResponse` |
| DELETE | `/v1/articles/{id}/polls/{pollId}/vote` | | `PollResponse` |

`PollResponse`: `{id, question, options: [{id, label, votes}], resultsVisibility, closesAt, closed, totalVotes, myVote,
resultsVisible, canEdit}`.

## Limits

Per-user quotas (429 with `Retry-After` beyond), all per user rather than per IP because the campus shares one
address: new comments and replies (`article-comments`, `RATE_LIMIT_ARTICLE_COMMENTS_*`, default 20 per 10m), reports
(`article-comment-reports`, `RATE_LIMIT_ARTICLE_COMMENT_REPORTS_*`, 30 per 10m), and likes plus poll votes together
(`article-reactions`, `RATE_LIMIT_ARTICLE_REACTIONS_*`, 120 per 10m). A token is taken only once a request passed its
checks, and undoing (unlike, removing a vote) is free.

Comments, likes and votes need a **published** article: on a draft (reachable only by its editors and STAFF) they
answer 409 `ArticleNotPublished`, so test reactions never land in the published counts.

## Account deletion

`DELETE /v1/me` removes the user's likes, reports, poll votes and replies, deletes their top-level comments left
without replies, and turns the rest into tombstones (author cleared, body emptied, unpinned, `deleted_at` set) so other people's
replies keep their thread. `article_comments.user_id` is `ON DELETE SET NULL`, so an API image older than V68 can
still delete a commenter's account on a rollback (leaving the body without an author).
