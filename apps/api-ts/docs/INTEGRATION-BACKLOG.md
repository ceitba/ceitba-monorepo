# Integration backlog (Bun port)

Shared-file changes that the feature agents asked for but must not make themselves. Close all of them before
cutover.

## Done
- `javaPattern`: `\s` inside a character class.
- `policy.ts` `ruleKey`: path variables whose regex contains braces. This was a security bug: the route lost its
  `@PreAuthorize` rule.
- `health-and-error` contract gate.
- SERIALIZATION.md: `@JsonProperty` components are written last.
- Stale ITBA warning in `deps.ts`.

## Open

### Security
- **Policy coverage test.** Fail if any `METHOD_RULES` key does not match a registered route. That kind of
  mismatch fails open.

### HTTP layer: `src/http`
- **`router.ts`:** add a spec option that provides the raw body text plus the validated body. The saved-schedule
  payloads keep Jackson's key order and number types, so `user/routes.ts` reads the raw text and currently
  duplicates the 415/400 rules.
- **`validation.ts`:**
  - add `jv.map(value, { size })`; `staff/dto.ts` currently pushes the private `{bean}` issue shape;
  - support `@JsonProperty` renames in `jv.object`: violations are named by the component (`fileNumber`), not the
    JSON key (`user/dto.ts` uses a `jsonNames` workaround).
- **`errors.test.ts`:** add cases for `EventRsvpError`, `studygroup/errors.ts` and `correction/errors.ts`.

### Lifecycle
- **Shutdown drain slot** in the jobs module or `main.ts`. It should await the kicked digest and orgmail workers
  (`idle()`) and call `sender.onShutdown()`, Java's `ContextClosedEvent` stop flag.

### Mail: `src/infra/mail.ts`
- The real Gmail transport is installed by the mail feature when the deps transport is unavailable. Replace that
  with a proper hook.
- SMTP: set an explicit Message-ID.
- Startup validation that Java's `MailConfig` does: blank `MAIL_USERNAME`/`MAIL_PASSWORD` with `smtp`, and
  `MAIL_FROM`.

### Push: `src/infra/push.ts`
- `FakePushGateway` does not record failed calls, unlike Java's fake.
- `pushMessage` duplicates the push feature's helper with different semantics. Make one the canonical version.
- `news/pushTriggers.ts` (`firePushes`) and `push/service.ts` (`firePush`) are two publish paths. Unify them on
  the push feature's API.

### ITBA client
- `createItbaClient(config, db)` should receive `deps.clock` and `deps.log`.

### Cross-feature
- `digest/correctionVote.ts` duplicates `ScheduleCorrectionService.vote`. Switch it to the correction feature's
  service.
- **Org delete:** `DELETE /v1/organizations/{slug}` should revoke the Google token through the mail feature,
  which is best-effort in Java.
- **Account deletion steps:** check that `scheduleCorrections.withdrawVotesOf` and `drive.prepareAccountDeletion`
  are registered. Otherwise `DELETE /v1/me` answers 500 for users with that data.
- **Move into `src/lib`:** jsonb re-rendering that keeps Postgres key order and `Double.toString` numbers
  (`share/jsonbJackson.ts`, also needed by `user`), and `OffsetDateTime.toString` (`studygroup/service.ts`).

### Harness: `contract/support`
- The readiness `fetch` has no timeout; a Java boot hung for 15 minutes under memory pressure.
- `freePort` race with several workers.
- `.hits` is wiped on every run, so coverage is unreliable while several runs overlap. Use per-run dirs and merge
  them.
- Contract cleanup can deadlock with the server's after-commit background work (TRUNCATE vs push delivery): clean-up should wait for the server to be idle (seen once in correction-schedule).
