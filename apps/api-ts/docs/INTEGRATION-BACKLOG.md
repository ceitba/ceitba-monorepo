# Integration backlog (Bun port)

Shared-file changes that the feature agents asked for but must not make themselves. Close all of them before
cutover.

## Open

Nothing.

## Done

### Earlier
- `javaPattern`: `\s` inside a character class.
- `policy.ts` `ruleKey`: path variables whose regex contains braces. This was a security bug: the route lost its
  `@PreAuthorize` rule.
- `health-and-error` contract gate.
- SERIALIZATION.md: `@JsonProperty` components are written last.
- Stale ITBA warning in `deps.ts`.

### Security
- **Policy coverage test:** `test/http/policy-coverage.test.ts` reads the Java controllers (class-level
  `@RequestMapping` prefixes and `@PreAuthorize` expanded, constants resolved) and `SecurityConfig`. It fails
  when a `METHOD_RULES` key matches no route, a Java `@PreAuthorize` endpoint has no rule or a different one
  (roles, checks and operators compared), a registered route has no Java endpoint, or `URL_RULES` differs from
  `authorizeHttpRequests` rule for rule.

### HTTP layer: `src/http`
- **`router.ts` raw body:** a handler with a `body` schema also gets the raw text in `rawBody`, after the JSON
  checks and validation. `user/routes.ts` dropped its own 415/400 copy.
- **`validation.ts`:** `jv.map(value, { size })`; `jv.object(shape, { json: { component: 'json_name' | [name,
  ...aliases] } })` for `@JsonProperty`/`@JsonAlias`, with violations named by the component. Optional object
  params (`Integer`, `UUID`, dates, enums) bind `?x=` as null, as checked on the jar
  (`contract/tests/request-params.contract.test.ts`).
- **`errors.test.ts`:** cases for `EventRsvpError`, `StudyGroupConflictError` and `ScheduleCorrectionError`.
- **`DuplicateKeyError`** carries the Postgres error as its `cause`, so any one that escapes is the global
  409 `DataIntegrityViolation`. Eval create lost its local catch.

### Lifecycle
- A `jobs.ts` can return `{ jobs, startup, shutdown }` (`src/jobs/scheduler.ts`). `main.ts` runs it in
  Spring's order:
  - **Startup** (`ApplicationReadyEvent`): readiness answers 503 until the hooks return, in Java's listener
    order: DigestJob, then KbPipelineJob (`ensureDefaultSet`, then resume), then KbRelationJob, then OrgMailJob.
  - **Shutdown, `closing`** (`ContextClosedEvent`): the digest and orgmail stop flags, before the drain.
  - **Shutdown, `executors`** (task executor await-termination): the digest and orgmail workers' `idle()` and
    `kbPipeline.engine.stop()`, after HTTP and the jobs, before the pool.
- kb-reader's readiness hold, kb-admin's fake fixed-delay job and the fixed-delay `onStartup` jobs are gone.
  `ensureDefaultSet` now runs only with `KB_PIPELINE_BACKGROUND`, as in Java. The evals still call it lazily.

### Mail: `src/infra/mail.ts`
- The Gmail transport has a proper hook. `createMailTransport` returns a `GmailApiTransportSlot` and the mail
  feature fills it.
- SMTP sets an explicit `Message-ID` in the sender's domain and refuses an invalid recipient as `RECIPIENT`.
- Startup fails like `MailConfig`: an unknown `MAIL_TRANSPORT`, an invalid `MAIL_FROM` (strict
  `InternetAddress`), SMTP without a host or with a blank `MAIL_USERNAME`/`MAIL_PASSWORD`, and `log` without
  `MAIL_LOG_SENDS`. Covered by `test/mail/transport.test.ts`.

### Push: `src/infra/push.ts`
- `FakePushGateway` is the Java fake: it records failed calls too, with `answer`/`failCall`/`allTokens`/`reset`.
- `PushMessage` has one definition, the push feature's. `infra/push.ts` only re-exports its type.
- `news/pushTriggers.ts` `firePushes` is now a thin adapter over `push/service.ts` `firePush`, so there is one
  listener, one FCM sender and one `push_log` writer.

### ITBA client
- `createItbaClient(config, db, clock, log)` gets `deps.clock` and `deps.log`.

### Cross-feature
- `digest/correctionVote.ts` votes through `ScheduleCorrectionService.vote`. The duplicate repo functions are
  removed.
- **Org delete:** it calls `mailBeans(deps).accounts.disconnectOrg(slug, tx)`, which revokes at Google (best
  effort) inside the delete transaction (`test/mail/accounts.test.ts`).
- **Account deletion steps:** both steps were registered. `test/user/account-deletion-steps.test.ts` now
  guards that.
- **Moved into `src/lib`:**
  - `src/lib/jackson.ts`: `readJacksonTree`/`JDouble`, the order-keeping `JNode` tree,
    `jacksonFromJsonbText`/`jsonWithRaw`;
  - `src/lib/time.ts`: `offsetDateTimeToString`.
  - Every call site was switched: user, share, kb-pipeline, kb-admin, `jsonNode.readTree` and studygroup.

### Harness: `contract/support`
- The readiness probe has a 2 s timeout, and a 120 s deadline kills the child.
- A spawn that loses its port to another worker is retried with a new one.
- Every run writes `.hits/<run id>/` and `.logs/<run id>/`. Coverage merges all runs, and runs older than a
  day are pruned.
- `TRUNCATE`/`DELETE` from a test first waits until no other session of the database is active or inside a
  transaction (`quiesce`).

### From kb-reader
- `deps.llm.embeddings` comes from `createEmbeddingClient`. The `embeddingClientOf` bridge is gone.
- `param.int`/`long`: an empty value gives null (see the HTTP layer above).
- The startup hook replaced the readiness hold (see Lifecycle).
- StaffKbController's routes use `kbReader(deps).importer`/`.moderation` and `KbImportRequest`, and are
  registered once (`collectRoutes` throws on a duplicate). The 4 SubjectWikiIT contract tests run on ts.
- `drive/kbHooks.ts` calls `kbReader(deps).moderation.hidePagesCiting`/`forgetFiles` in the drive session's
  transaction. The duplicated SQL is gone, and so is its narrower frozen-inputs walk (arrays only).
- IN-PROCESS.md rows added.

### From kb-pipeline
- `engine.stop()` runs at shutdown (Lifecycle).
- **Atomic PUBLISH:** the importer registration forwards `tx` to `validate`/`importSubject` (verified).
- IN-PROCESS.md rows added.
- `bun run test` is `bun test ./test`: unit and in-process tests only. Contract tests run only through
  `contract/run.ts`.

### From kb-admin
- The startup hook, the single route registration and the shared Jackson reader are done (see above).
- `DuplicateKeyError` maps to 409 globally (see the HTTP layer above).

### Test parity
- `bun contract/parity.ts --check` matches every Java test method (inherited ones included) to a TS test
  with the same name.
- Intentional non-ports, with their reasons, are in `contract/parity-exclusions.json`.

## Won't do
- **A required object `@RequestParam` sent empty** (Spring: 400 "present but converted to null"): no
  controller has one. All empty-value cases that exist are pinned by `request-params.contract.test.ts`.
- **`DriveSyncTrigger`'s `@PreDestroy` `shutdownNow()`:** this interrupts queued syncs. The process exit does
  the same, and a requested sync is re-run by the next periodic sync.
