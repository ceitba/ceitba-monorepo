# Java tests that cannot be black-box

The contract suite (`contract/tests/`) only talks HTTP to a real server process, so it runs unchanged
against the Spring Boot jar and the Bun app. A Java IT that needs something a black-box jar cannot give
(an injected fake, a stubbed external service, a transaction held open, a private component) is ported
instead as an in-process test under `test/`: it builds the TS app with `test/support/app.ts`
(`testApp({ env, overrides })`: a fresh clone of the contract template database, real `createApp(deps)`
with the fakes swapped in, `app.request()`), so it runs against TS only.

| Java test | In-process port | Why not black-box |
|---|---|---|
| `AuthMobileIT` (all token checks) | `test/auth/mobile-login.test.ts` | Needs Google ID tokens signed by a key the server trusts; the jar only trusts Google's JWKS URL (hard-coded). TS injects the real verifier with a local RSA key (`test/support/google.ts`, = `TestGoogleIdTokens`). The 400/501 cases are black-box: `contract/tests/auth-mobile.contract.test.ts` |
| `ReviewLoginIT.googleLoginWithTheReviewEmailIsStillRejected` | `test/auth/review-google.test.ts` | Same: a locally signed Google token |
| `AuthOAuthFlowIT.fullFlow_withMatchingCookie_logsInAndRedirectsToTarget`, `googleLogin_lookalikeRedirect_fallsBackToFrontend` | `test/auth/oauth-flow.test.ts` | They stub Google's code exchange (`StubGoogle`); a jar would call `oauth2.googleapis.com` for real. Every other AuthOAuthFlowIT test never reaches the exchange and is black-box (`auth-oauth-flow.contract.test.ts`) |
| `RefreshTokenIT.logoutDuringAnUncommittedRotationAlsoRevokesTheSuccessor`, `logoutAllDuringAnUncommittedRotationAlsoRevokesTheSuccessor` | `test/auth/refresh-concurrency.test.ts` | They hold a rotation transaction open while a revocation runs; that needs the service, not HTTP |
| `StaffRoleDetectionIT` | `test/auth/roles.test.ts` | Drives `StaffAwareJwtAuthenticationConverter` directly (`jwtRoles` in TS). Its HTTP effects are covered by the staff/role assertions of the contract tests |
| `AuthIT.allowlist*` (4 tests on `AuthProperties.admits`) | `test/auth/units.test.ts` | Plain unit assertions on a component |
| `MailAccountsIT` (`callbackStores…`, the `wrong_account`/`missing_scope` parts, `…DeleteRevokesAtGoogle`), `OrgMailConnectIT` (`callbackStores…`, `wrong_domain`/`account_in_use`) | `test/mail/accounts.test.ts` | They stub `GoogleMailOAuthClient.exchangeCode`/`revoke` (@SpyBean); a jar would call Google. The refusals before the exchange and the consent URL are black-box: `mail-accounts`, `orgmail-connect` contract tests |
| `MailTrackingIT.retentionDeletesOldTrackingAndSendLogRowsOnly` | `test/mail/retention.test.ts` | Calls `MailRetentionService.cleanup()` (the job runs nightly at 03:40) |
| `OrgMailIT.pendingDeliveriesWaitForTheOrgsAccountAndResumeFromTheNewOne` | `test/orgmail/sender.test.ts` | Drives `OrgAnnouncementSender.runPending()` between account changes; a black-box worker, kicked right after the send, races them. The other worker-dependent tests run black-box on a server with `ORG_MAIL_JOBS_ENABLED`/`DIGEST_JOBS_ENABLED` and poll |
| `DigestEndpointsIT.cancelWhileSendingDropsWhatIsLeft` (the worker part) | `test/digest/sender.test.ts` | Same: the cancel itself is black-box (worker off), "nothing goes out afterwards" needs `runPending()` |
| Unit tests `DigestSenderTest`, `DigestServiceTest`, `DigestTrackingServiceTest`, `DigestComposerCapabilityTest`, `MailSenderAccountServiceTest` | `test/digest/{sender,service}.test.ts`, `test/mail/accounts.test.ts` | Mockito tests of services: ported against the real repositories on a database clone, with the Java tests' fakes (MutableClock, recording transport, counting sleeper) |
| `JobLockIT` | `test/jobs/joblock.test.ts` | Calls `JobLock` directly with a second session holding the lock |
| `JobLockCoverageTest` | `test/jobs/joblock-coverage.test.ts` | Scans the scheduled jobs (TS: every `jobs.ts`, all flags on) instead of `@Scheduled` methods |
| `ShutdownDrainTest`, `HealthProbesIT` drain part | `test/http/shutdown.test.ts` | Needs to trigger shutdown and probe during the drain |
| Unit tests (`ApiKeyFilterTest`, `SafeRedirectTest`, `CookieOrHeaderBearerTokenResolverTest`, `IssuerAudienceValidatorTest`, `AuthControllerLogoutTest`, `SessionAllowlistTest`, `RateLimitFilterTest`) | `test/auth/units.test.ts`, `test/http/ratelimit.test.ts` | Unit tests of components, not ITs |

| `PushTriggerIT` (all 10) | `test/news/push-trigger.test.ts` | FakePushGateway in place of FCM; awaits the async after-commit delivery (`pendingPushes()`) |
| `EventSignupIT.dayBeforeReminderIsClaimedOnce` | `test/news/event-reminders.test.ts` | Calls the reminder service directly; the rest of EventSignupIT is black-box |
| `ProposalPushIT` (all 5) | `test/proposal/ProposalPush.test.ts` | FakePushGateway + awaiting the async after-commit delivery |
| `StaffProposalControllerIT` event assertions (`@RecordApplicationEvents`) | `test/proposal/StaffProposalEvents.test.ts` | Application events are internal; the HTTP parts are black-box in `proposal-staff.contract.test.ts` |
| `ScheduleCorrectionIT` sync/push tests (3) | `test/correction/schedule-correction.test.ts` | Stub the ITBA client and read the push payload from FakePushGateway |
| `StudyGroupServiceTest`, `ProposalServiceTest`, `ProposalStatusPushNotifierTest` (units) | `test/studygroup/service.test.ts`, `test/proposal/*.test.ts` | Mockito units ported DB-backed / with fakes |
| `MeProfileIT.savingTheEntityDoesNotOverwriteColumnsWrittenConcurrently` | `test/user/me-profile-dynamic-update.test.ts` | Holds a transaction with a stale read while another connection commits |
| `AccountDeletionIT.concurrentDeletionsCannotRemoveTheLastStaffMember` | `test/user/account-deletion-concurrency.test.ts` | Holds one deletion's transaction open while a second runs |
| `ModeratorIT` `authoritiesOf(...)` assertions | `test/staff/moderator-roles.test.ts` | Calls the role converter directly |
| `PushBroadcastIT` tokens/message assertions | `test/push/push-broadcast.test.ts` | Needs an injected fake gateway; the HTTP side is black-box and observes `push_log` |
| `MinioPresignedUploadIT` | `test/media/minio-presigned-upload.test.ts` | Starts MinIO + mc + Caddy from the repo's compose files; skipped without Docker images |
| `ClassroomAvailabilityIT.anonymousGetsFreeRoomsForNowInArt` | `test/classroom/availability-clock.test.ts` | Day/time defaults come from the clock |
| `OrganizedSubjectsIT.externalItbaCallRunsOutsideAnyTransaction` | `test/subject/organized-subjects-tx.test.ts` | Fake client inspects `pg_stat_activity` during the call |
| `HighlightsIT` exact `startsAt`/`endsAt == now` boundaries | `test/highlight/highlights-clock.test.ts` | Needs a fixed clock; a black-box copy also exists |
| `DataSyncServiceIT` counters | `test/sync/DataSyncServiceIT.test.ts` | Asserts counters the API never serializes; black-box copy runs via the mock ITBA gateway |
| `FirestoreImportServiceTest`, `ProposalFirestoreImporterTest`, `DataSyncJob` | `test/sync/*.test.ts` | Unit/component tests |
| `DriveSyncIT` (all 10, in full) | `test/drive/DriveSyncIT.test.ts` | Mutates the injected FakeDriveClient, inspects InMemoryObjectStorage and calls the sync service directly. Black-box subsets of every test: `contract/tests/drive-sync.contract.test.ts` (demo folders + S3 mock) |
| `DriveSourceServiceTest` | `test/drive/DriveSourceService.test.ts` | The Java test mocks repositories |
| `KbAdminEvalIT.cancellingAnEvalCascades`, `evalUsesFrozenInputsNeverPublishesAndFeedsTheLeaderboard`, the DO-catalog half of `modelSyncTakesPricesFromDoCatalogWithoutClobberingProbesOrManualFields`, and the 9 tests it inherits from `KbPipelineAcceptanceIT` | `test/kb-admin/KbAdminEvalIT.test.ts` | They advance evals with `engine.advanceActive()`, hold the fake batch, read InMemoryObjectStorage and the fake executors' requests, and script FakeDoModelCatalog items. Black-box: `settingsAreValidatedVersionedAndRestorable`, `catalogForecastAndStageCost`, `costsAcceptDateOnly...` (usage rows seeded instead of `run()`) and the catalog-unreachable half of the sync in `contract/tests/kb-admin-{settings,models,costs}.contract.test.ts`; eval endpoints that need no advancing in `kb-admin-evals` |
| `KbEmbeddingIT` (3) | `test/kb-reader/embedding.test.ts` | Drives the embedding sweep with the fake embedding client; the search side is black-box in `kb-reader-embedding.contract.test.ts` |
| `SubjectWikiIT` staff side | `test/kb-reader/subject-wiki.test.ts` | Calls the import/moderation services directly; the HTTP side is black-box in `kb-reader-subject-wiki.contract.test.ts` |
| `BatchPipelineIT`, `SyncPipelineIT` (+ the tests they inherit from `KbPipelineAcceptanceIT`) | `test/kb-pipeline/{Batch,Sync}PipelineIT.test.ts` | Advance runs with the engine, script the fake LLM batch/chat clients and read InMemoryObjectStorage |
| `KbKickIT` | `test/kb-pipeline/KbKickIT.test.ts` | Awaits the engine's background advances |
| `LocalTemporalZoneIT` | `test/db/local-temporal-zone.test.ts` | Reads/writes through the repositories (Java: JPA) and checks the session zone (Java: no `hibernate.jdbc.time_zone`). `endpointsServeSqlWrittenTimesUnshifted` is also black-box: `local-temporal-zone.contract.test.ts` |
| `SchemaValidationIT`, `ProdMigrationsIT`, `NewsCategoryMigrationIT` | `test/db/migrate.test.ts` | Run the Flyway-compatible runner on fresh databases; "Hibernate validate" becomes "every drizzle table/column exists" |
| `ShutdownDrainTest` | `test/http/shutdown.test.ts` | Starts `src/main.ts`'s server and shuts it down |
| `RateLimitFilterTest` | `test/http/ratelimit-filter.test.ts` | The limiter with the test's own rule and a manual clock; the 429 shape through the app |
| `GlobalExceptionHandlerTest` | `test/http/global-exception-handler.test.ts` | A throwaway route throws each exception through the real app |
| Unit tests `ReviewLoginServiceTest`, `OAuthStateServiceTest`, `UserMeServiceTest`, `JwksGoogleIdTokenVerifierTest`, `ApiKeyScopeTest`, `UserRateLimiterTest`, `PushConfigTest`, `StorageEnvFallbackTest`, `MobileAppPropertiesTest`, `JwtIssuerAudienceEnforcementTest` | `test/auth/*.test.ts`, `test/http/ratelimit.test.ts`, `test/config/properties.test.ts` | Unit tests of services and config |

`bun contract/parity.ts --check` lists every Java test method and fails when one has no TS test of the
same name in a file that names its Java class (or a row here). The three Java tests that are intentionally
not ported are in `contract/parity-exclusions.json`, each with its reason.
