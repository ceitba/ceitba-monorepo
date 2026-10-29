# What clients depend on: the compatibility contract

Plan §5 phase 0 (`docs/plans/api-bun-rewrite.md`). The web app, the MCP server and the mobile app were written
against the Spring app; this page lists the observable behaviour they rely on, what the Bun API answers, and which
test holds it. "Contract test" files are in `contract/tests/` and run against the Bun server in CI. They were green against the jar of the last
Java commit (`b515215`) when the API moved to Bun, and still run against it locally with
`CONTRACT_JAR=<jar> bun contract/run.ts --target java`; files under `test/` are in-process tests. A row marked **TS only** is a
deliberate change from Java, listed in [Intentional differences](#intentional-differences-from-java) and skipped on
the Java target.

## Session cookie (web)

| What | Value | Enforced by |
|---|---|---|
| Name | `ceitba_session` (`AUTH_COOKIE_NAME`) | `auth.contract.test.ts` `sessionCookieAuthenticates` |
| Set on login | `ceitba_session=<jwt>; Path=/; Max-Age=<ttl>; Expires=<RFC 1123>; Secure; HttpOnly; SameSite=Lax` (Spring `ResponseCookie` order; `Domain=` only when `AUTH_COOKIE_DOMAIN` is set; no `Secure` under the `dev` profile) | `dev-login.contract.test.ts`, `test/auth/oauth-flow.test.ts` |
| Max-Age | `AUTH_JWT_TTL_DAYS` days (default 7; `<= 0` means 7) | `dev-login.contract.test.ts` (1 day in the test profile) |
| Cleared on logout | `ceitba_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax`, plus the host-only variant when a Domain is configured | `refresh-token.contract.test.ts` `logoutWithANonJsonBodyStillClearsTheCookie`, `test/auth/units.test.ts` |
| Read | the `Authorization: Bearer` header wins over the cookie; an empty cookie value is "no token"; the token endpoints ignore both | `auth.contract.test.ts`, `refresh-token.contract.test.ts` `refreshIgnoresAnExpiredBearerHeader` |
| OAuth login state | `ceitba_oauth_state` (HttpOnly, SameSite=Lax, Path=/, 10 min), bound to the signed `state` | `auth-oauth-flow.contract.test.ts` |
| Mail-account OAuth nonce (**TS only**) | `ceitba_mail_oauth_nonce` (HttpOnly, SameSite=Lax, Secure per config, 10 min, `Path=/api/v1/mail/accounts/oauth/callback`) | `mail-oauth-binding.contract.test.ts` |

## JWTs

| What | Value | Enforced by |
|---|---|---|
| Algorithm, key | HS256 over the base64-decoded `AUTH_JWT_SECRET` (>= 32 bytes); header `{"alg":"HS256"}` | `cross-signing.contract.test.ts` (same header as Java's) |
| Claims (in this order) | `aud`, `sub` (user id), `iss`, `name` (omitted when null), `exp`, `iat`, `jti` (random UUID), `email` | `cross-signing.contract.test.ts` (same key order as Java's) |
| `iss` / `aud` | `AUTH_JWT_ISSUER` (default `https://ceitba.org.ar/api`) / `ceitba-api`; enforced unless `AUTH_JWT_ENFORCE_ISS_AUD=false` (phase-in: a present claim must still match) | `jwt-issuer-audience.contract.test.ts`, `test/auth/units.test.ts` |
| Web session TTL | `AUTH_JWT_TTL_DAYS` (7 days) | `dev-login.contract.test.ts` |
| Mobile access token TTL | `AUTH_MOBILE_ACCESS_TTL` (15 min); `accessTokenExpiresAt` is `exp` at second precision (`...Z`) | `test/auth/mobile-login.test.ts`, `refresh-token.contract.test.ts` `refreshRotatesTheToken` |
| Refresh token TTL | `AUTH_REFRESH_TTL` (60 days) | `test/auth/mobile-login.test.ts` |
| Refresh rotation | every refresh rotates; reusing a rotated token revokes the whole family, except a retry within `AUTH_REFRESH_REUSE_GRACE` (60 s) of the rotation while its successor is unused, which issues a new successor | `refresh-token.contract.test.ts` (`retryWithinGraceWindow...`, `reusingARotatedTokenAfterTheGraceWindow...`, `...WhoseSuccessorWasUsed...`), `test/auth/refresh-concurrency.test.ts` |
| Token response shape | `{accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, user}`, `Cache-Control: no-store` | `refresh-token.contract.test.ts`, `review-login.contract.test.ts` |
| Bad token | 401, empty body, `WWW-Authenticate: Bearer error="invalid_token", error_description="<Spring's text>", error_uri="https://tools.ietf.org/html/rfc6750#section-3.1"` | `auth.contract.test.ts` |
| Tokens cross runtimes | a Java token works on Bun and the reverse; a refresh family continues across them | `cross-signing.contract.test.ts`, `cross-runtime.contract.test.ts` (jar-gated) |

## Authorization outcomes

| Case | Answer | Enforced by |
|---|---|---|
| URL rule denies an anonymous caller | 401, empty body, `WWW-Authenticate: Bearer` | `health-and-error.contract.test.ts` `unknownRouteIs401AnonymousAnd404Authenticated` |
| URL rule denies an authenticated caller | 403, empty body; `WWW-Authenticate: Bearer error="insufficient_scope", ...` for a JWT, plain `Bearer` for an API key or the sync key | `auth.contract.test.ts`, `api-key-scopes.contract.test.ts` |
| METHOD rule denies | 403 `AccessDenied` / `Insufficient permissions` (JSON) | `career.contract.test.ts`, `test/http/policy-coverage.test.ts` (rules = the Java snapshot) |
| API key without `write` on a write | 403 `INSUFFICIENT_SCOPE` | `api-key-scopes.contract.test.ts` |
| De-allowlisted session on a public route (**TS only**) | runs as anonymous | `allowlist-public-reads.contract.test.ts` |

## Error bodies

Every error is JSON `{"error", "message", "path", "timestamp"}` in that order (`path` = the raw request URI with
`/api`, `timestamp` = `Instant` with millisecond groups), `Content-Type: application/json`. Extra keys only where
listed (`resumeAt` on `MAIL_QUOTA_EXHAUSTED`). Bean Validation messages follow the request locale
(`Accept-Language: es-AR`: `no debe estar vacío`; none: `en_US`): `validation-locale.contract.test.ts`.

The table below is generated from `src/http/errors.ts` and the feature error enums by
`bun contract/compatibility-errors.ts --write`; `test/http/compatibility-doc.test.ts` fails when it is stale. Every
row's status/code mapping is also pinned by `test/http/errors.test.ts`; the last column names a contract test that
asserts the code over HTTP (the mapping test when none does).

<!-- errors:begin (generated: bun contract/compatibility-errors.ts --write) -->
| Status | `error` | Message | Thrown as | Enforced by |
|---|---|---|---|---|
| 400 | `AUTO_SEND_IN_PAST` | <message> | DigestException AUTO_SEND_IN_PAST | `digest-endpoints.contract.test.ts` |
| 400 | `BadRequest` | Method parameter '<name>': Failed to convert value of type 'java.lang.String' to required type '<javaType>'; <cause> | ArgumentTypeMismatchError | `classroom-endpoints.contract.test.ts` |
| 400 | `BadRequest` | Malformed or invalid request body | MalformedBodyError | `classroom-endpoints.contract.test.ts` |
| 400 | `BadRequest` | Required request parameter '<name>' for method parameter type String is not present | MissingParameterError | `classroom-endpoints.contract.test.ts` |
| 400 | `DRIVE_INVALID_FOLDER_URL` | <message> | DriveError INVALID_FOLDER_URL | `drive-sync.contract.test.ts` |
| 400 | `INVALID_TOKEN` | <message> | DigestException INVALID_TOKEN | `digest-correction-vote.contract.test.ts` |
| 400 | `INVALID_VOTE` | <message> | DigestException INVALID_VOTE | `digest-correction-vote.contract.test.ts` |
| 400 | `INVALID_WEEK_START` | <message> | DigestException INVALID_WEEK_START | `digest-endpoints.contract.test.ts` |
| 400 | `InvalidSlug` | <message> | InvalidBenefitSlugError | `staff-benefits.contract.test.ts` |
| 400 | `SameAsSga` | <message> | ScheduleCorrectionError SAME_AS_SGA | `correction-schedule.contract.test.ts` |
| 400 | `ValidationError` | <field>: <message>; ... (request locale) | BeanValidationError (@Valid body) | `validation-locale.contract.test.ts` |
| 400 | `ValidationError` | <message> | ConstraintViolationError | `auth-mobile.contract.test.ts` |
| 400 | `ValidationError` | Validation failed for field '<field>' with value '<value>': <reason> | ValidationError | `api-key-scopes.contract.test.ts` |
| 401 | `invalid_credentials` | Invalid email or password | InvalidCredentialsError | `review-login.contract.test.ts` |
| 401 | `invalid_token` | <message> | InvalidTokenError | `auth.contract.test.ts` |
| 403 | `AccessDenied` | Insufficient permissions | AccessDeniedError (METHOD_RULES denial) | `career.contract.test.ts` |
| 403 | `AccessDenied` | <message> | ReviewAccountRestrictedError | `review-login.contract.test.ts` |
| 403 | `AccessDenied` | <message> | StudyGroupForbiddenError | `studygroup-controller.contract.test.ts` |
| 403 | `CAPABILITY_REQUIRED` | This feature requires the '<key>' capability | CapabilityRequiredError | `digest-endpoints.contract.test.ts` |
| 403 | `DRIVE_FOLDER_NOT_OWNED` | <message> | DriveError FOLDER_NOT_OWNED | `drive-sync.contract.test.ts` |
| 403 | `INSUFFICIENT_SCOPE` | <message> | InsufficientScopeError (API key scopes) | `api-key-scopes.contract.test.ts` |
| 403 | `unauthorized` | Email is not allowed to sign in | LoginRejectedError NOT_ALLOWLISTED | `refresh-token.contract.test.ts` |
| 403 | `unauthorized_workspace` | Google Workspace domain is not allowed to sign in | LoginRejectedError WORKSPACE_NOT_ALLOWED | `test/http/errors.test.ts` |
| 403 | `unverified_email` | Google account email is not verified | LoginRejectedError UNVERIFIED_EMAIL | `test/http/errors.test.ts` |
| 404 | `CORRECTION_NOT_FOUND` | <message> | DigestException CORRECTION_NOT_FOUND | `digest-correction-vote.contract.test.ts` |
| 404 | `KB_NO_PAIRS` | <message> | KbPipelineError NO_PAIRS | `kb-admin-evals.contract.test.ts` |
| 404 | `NotFound` | No static resource <path>. | NoResourceFoundError (no route) | `health-and-error.contract.test.ts` |
| 404 | `NotFound` | Not found | ReviewLoginDisabledError | `health-and-error.contract.test.ts` |
| 404 | `ResourceNotFound` | <Resource> with identifier '<id>' not found | ResourceNotFoundError | `accept-negotiation.contract.test.ts` |
| 405 | `MethodNotAllowed` | Method '<METHOD>' is not supported. | MethodNotAllowedError (+ Allow) | `health-and-error.contract.test.ts` |
| 406 | `NotAcceptable` | Acceptable representations: [text/html]. | NotAcceptableError (+ Accept; `produces` routes only) | `accept-negotiation.contract.test.ts` |
| 409 | `AlreadySuggested` | <message> | ScheduleCorrectionError ALREADY_SUGGESTED | `correction-schedule.contract.test.ts` |
| 409 | `BOOKMARK_LIMIT` | <message> | BookmarkLimitError | `wiki-bookmarks.contract.test.ts` |
| 409 | `CommissionEnded` | <message> | ScheduleCorrectionError COMMISSION_ENDED | `correction-schedule.contract.test.ts` |
| 409 | `CORRECTION_CLOSED` | <message> | DigestException CORRECTION_CLOSED | `digest-correction-vote.contract.test.ts` |
| 409 | `DataIntegrityViolation` | Operation violates a database constraint | DataIntegrityViolationError (SQLSTATE 22/23 that escapes) | `career.contract.test.ts` |
| 409 | `DIGEST_EMPTY` | <message> | DigestException DIGEST_EMPTY | `digest-endpoints.contract.test.ts` |
| 409 | `DIGEST_EXISTS` | <message> | DigestException DIGEST_EXISTS | `digest-endpoints.contract.test.ts` |
| 409 | `DIGEST_NOT_EDITABLE` | <message> | DigestException DIGEST_NOT_EDITABLE | `digest-endpoints.contract.test.ts` |
| 409 | `DIGEST_SENDING` | <message> | DigestException DIGEST_SENDING | `digest-endpoints.contract.test.ts` |
| 409 | `DRIVE_SOURCE_BLOCKED` | <message> | DriveError SOURCE_BLOCKED | `drive-sync.contract.test.ts` |
| 409 | `DRIVE_SOURCE_EXISTS` | <message> | DriveError SOURCE_EXISTS | `drive-sync.contract.test.ts` |
| 409 | `EventEnded` | This event already took place | EventRsvpError ENDED | `news-event-signup.contract.test.ts` |
| 409 | `EventFull` | This event is full | EventRsvpError FULL | `news-event-signup.contract.test.ts` |
| 409 | `EventNotRsvp` | This event does not take RSVPs | EventRsvpError NOT_RSVP | `news-event-signup.contract.test.ts` |
| 409 | `FileNumberAlreadySet` | <message> | FileNumberAlreadySetError | `user-me-profile.contract.test.ts` |
| 409 | `FileNumberTaken` | <message> | FileNumberTakenError | `user-me-profile.contract.test.ts` |
| 409 | `InvalidState` | <message> | InvalidStateError | `correction-schedule.contract.test.ts` |
| 409 | `KB_ENDPOINT_IN_USE` | <message> | KbEndpointInUseError | `kb-admin-endpoints.contract.test.ts` |
| 409 | `KB_EVAL_ACTIVE` | <message> | KbPipelineError EVAL_ACTIVE | `kb-admin-evals.contract.test.ts` |
| 409 | `KB_RUN_ACTIVE` | <message> | KbPipelineError RUN_ACTIVE | `kb-admin-pipeline.contract.test.ts` |
| 409 | `KB_RUN_NOT_ACTIVE` | <message> | KbPipelineError RUN_NOT_ACTIVE | `kb-admin-evals.contract.test.ts` |
| 409 | `KB_RUN_NOT_BLOCKED` | <message> | KbPipelineError RUN_NOT_BLOCKED | `kb-admin-pipeline.contract.test.ts` |
| 409 | `LastActiveStaff` | <message> | LastActiveStaffError | `staff-endpoints.contract.test.ts` |
| 409 | `LastOrgAdmin` | <message> | LastOrgAdminError | `news-org-members-endpoints.contract.test.ts` |
| 409 | `MAIL_DISABLED` | <message> | DigestException MAIL_DISABLED | `test/http/errors.test.ts` |
| 409 | `MAIL_SENDER_NOT_CONNECTED` | <message> | MailSenderNotConnectedError / MailSenderNotConnected | `mail-accounts.contract.test.ts` |
| 409 | `MailDisabled` | Sending email is disabled on this server | OrgMailError MAIL_DISABLED | `test/http/errors.test.ts` |
| 409 | `OrgMailNoRecipients` | No follower can receive this email | OrgMailError NO_RECIPIENTS | `test/http/errors.test.ts` |
| 409 | `OrgMailNotConnected` | The organization has no connected Gmail account | OrgMailError NOT_CONNECTED | `orgmail-announcements.contract.test.ts` |
| 409 | `OrgMailNotDraft` | Only drafts can be changed or sent | OrgMailError NOT_DRAFT | `orgmail-announcements.contract.test.ts` |
| 409 | `OrgMailTestFailed` | The test email could not be sent | OrgMailError TEST_FAILED | `test/http/errors.test.ts` |
| 409 | `OrgMailWeeklyLimit` | The organization already sent its emails for this week | OrgMailError WEEKLY_LIMIT | `orgmail-announcements.contract.test.ts` |
| 409 | `ResourceAlreadyExists` | <Resource> with identifier '<id>' already exists | ResourceAlreadyExistsError | `career.contract.test.ts` |
| 409 | `StudyGroupCapacityBelowMembers` | <message> | StudyGroupConflictError CAPACITY_BELOW_MEMBERS | `studygroup-controller.contract.test.ts` |
| 409 | `StudyGroupFull` | <message> | StudyGroupConflictError FULL | `studygroup-controller.contract.test.ts` |
| 409 | `StudyGroupPastDue` | <message> | StudyGroupConflictError PAST_DUE | `studygroup-controller.contract.test.ts` |
| 410 | `TOKEN_EXPIRED` | <message> | DigestException TOKEN_EXPIRED | `digest-correction-vote.contract.test.ts` |
| 413 | `PayloadTooLarge` | Maximum upload size exceeded | PayloadTooLargeError (body over the route cap; TS only) | `request-body-size.contract.test.ts` |
| 415 | `UnsupportedMediaType` | Content-Type '<type>' is not supported. | UnsupportedMediaTypeError (+ Accept) | `health-and-error.contract.test.ts` |
| 422 | `DRIVE_FOLDER_NOT_SHARED` | <message> | DriveError FOLDER_NOT_SHARED | `drive-sync.contract.test.ts` |
| 422 | `EMAIL_NOT_ALLOWED` | <message> | DigestException EMAIL_NOT_ALLOWED | `digest-endpoints.contract.test.ts` |
| 429 | `DRIVE_SYNC_RATE_LIMITED` | <message> | DriveError SYNC_RATE_LIMITED | `drive-sync.contract.test.ts` |
| 429 | `MAIL_QUOTA_EXHAUSTED` | <message> | MailQuotaExhaustedError (+ resumeAt, Retry-After) | `mail-tracking.contract.test.ts` |
| 429 | `TooManyRequests` | Rate limit exceeded. Retry in <n>s. | per-IP rate limit (security filter; + Retry-After, X-RateLimit-*) | `rate-limit.contract.test.ts` |
| 429 | `TooManyRequests` | Rate limit exceeded. Retry in <n>s. | RateLimitExceededError (per-user quotas; + Retry-After) | `media-endpoints.contract.test.ts` |
| 500 | `InternalServerError` | An unexpected error occurred | anything else (InternalServerError, UnexpectedStateError, foreign errors) | `mail-accounts.contract.test.ts` |
| 501 | `NotImplemented` | <message> | FeatureNotConfiguredError | `auth-mobile.contract.test.ts` |
| 502 | `ExternalApiError` | External API error in <service> during <operation> | ExternalApiError | `kb-admin-endpoints.contract.test.ts` |
| 503 | `DRIVE_SYNC_UNCONFIGURED` | <message> | DriveError SYNC_UNCONFIGURED | `dev-login.contract.test.ts` |
| 503 | `KB_LLM_UNCONFIGURED` | <message> | KbPipelineError LLM_UNCONFIGURED | `test/http/errors.test.ts` |
<!-- errors:end -->

## JSON output (Jackson rules)

Byte-compatible with what Spring's Jackson wrote: key order = record order, `null`s written, `OffsetDateTime` read
from the database prints `...Z` and one computed in the app `...-03:00`, `Instant` prints its fraction in groups of 3,
`double` fields print like Java (`javaDouble`), `numeric` like `BigDecimal`, `TIME` columns as `HH:mm:ss.SSS`
truncated. The full rules are in [`docs/SERIALIZATION.md`](../docs/SERIALIZATION.md); they are held by byte-level
`r.text` assertions across the contract suite (e.g. `career.contract.test.ts`, `local-temporal-zone.contract.test.ts`,
`news-organization-endpoints.contract.test.ts`) and `test/lib/*`.

## CORS and security headers

| What | Value | Enforced by |
|---|---|---|
| Allowed origins | `https://ceitba.org.ar`, `https://itbanews.ar`, `https://www.itbanews.ar`, `http://localhost:3000`, `:3001`, `:5173`, `:5175` (`CORS_ALLOWED_ORIGINS`) | `health-and-error.contract.test.ts` `corsPreflightAndRejection` |
| Preflight | 200, `Access-Control-Allow-Origin: <origin>`, `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS,PATCH`, `Access-Control-Allow-Headers: <the requested ones>` (allowed: `Content-Type`, `Authorization`, `X-Requested-With`, `X-API-Key`) | same |
| Rejected origin/method/header | 403, body `Invalid CORS request`, no Content-Type | same |
| Simple request | `Access-Control-Allow-Origin: <origin>` + `Access-Control-Allow-Credentials: true` | same |
| Every response | `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`, `Cache-Control: no-cache, no-store, max-age=0, must-revalidate`, `Pragma: no-cache`, `Expires: 0`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 0` | `health-and-error.contract.test.ts` `securityHeadersOnEveryResponse` |

## Rate limits

| What | Value | Enforced by |
|---|---|---|
| Per-IP rules | `rate-limit.rules` (`src/config/sections/rateLimit.ts`: auth 20/min except the excluded auth paths, mobile login 120/min, review login 10/min, refresh 120/min, article/correction votes and RSVPs 60/min, schedule corrections 10/h, digest/org-mail unsubscribe and correction votes 60/min, analytics 120/min); the client is the right-most `X-Forwarded-For` entry when `RATE_LIMIT_TRUST_FORWARDED_FOR`; IPv6 clients share their /64 | `rate-limit.contract.test.ts`, `correction-rate-limit.contract.test.ts` |
| Headers on a limited route | `X-RateLimit-Limit: <capacity>`, `X-RateLimit-Remaining: <left>` | `rate-limit.contract.test.ts` `authEndpointsAreLimitedPerIp` |
| 429 | `Retry-After: <s>`, `X-RateLimit-Remaining: 0`, body `{"error":"TooManyRequests","message":"Rate limit exceeded. Retry in <s>s.","path","timestamp"}` | `rate-limit.contract.test.ts`, `correction-rate-limit.contract.test.ts` |
| Per-user quotas | `rate-limit.user-rules` (proposals, comments, attachments, org images, wiki search): same 429 body + `Retry-After` | `media-endpoints.contract.test.ts` (proposal attachments), `test/http/ratelimit.test.ts` |
| Path matched (**TS only**) | the decoded path, like routing (Java: the raw URI) | `rate-limit-decoded-path.contract.test.ts` |

## Health and readiness

| Path | Body | Enforced by |
|---|---|---|
| `GET /api/` | `{"message":"CEITBA API is running","version":"1.0.0","environment","timestamp"}` | `health-and-error.contract.test.ts` `rootReturnsApiStatus` |
| `GET /api/health` | `{"status":"healthy","timestamp","uptime","memory":{"total","free","used","max"},"version":"1.0.0"}` | `healthReturnsHealthy` |
| `GET /api/actuator/health` | `{"status":"UP","groups":["liveness","readiness"]}` (`DOWN` / `OUT_OF_SERVICE` + 503), `Content-Type: application/vnd.spring-boot.actuator.v3+json` | `actuatorContentType` |
| `GET /api/actuator/health/liveness` | `{"status":"UP"}` (503 `DOWN`) | `readinessAndLivenessAreUpAndPublic`, `actuatorContentType` |
| `GET /api/actuator/health/readiness` | `{"status":"UP"}`; 503 `{"status":"OUT_OF_SERVICE"}` from the start of a graceful shutdown (blue/green drain) | `readinessAndLivenessAreUpAndPublic`, `test/http/shutdown.test.ts` |
| `GET /api/actuator/info` | `{}` | `actuatorContentType` |
| `GET /api/docs.json` | springdoc's document (`src/http/openapi.json`), `servers` = the request origin + `/api` | `openApiDocsAreServed`, `test/http/openapi.test.ts` |

## Intentional differences from Java

Most were security findings on the port; the tests that pin them skip on the Java target.

| Change | Java | Bun | Test |
|---|---|---|---|
| Rate-limit path | matched the raw URI: `/v1/articles/x/v%6Ftes` reached the route but escaped the votes bucket | matches the decoded path | `rate-limit-decoded-path.contract.test.ts` |
| Request body size | no cap on JSON bodies | 1 MiB per body, 10 MiB on authored content (articles, events, announcements, digests), 64 MiB on bulk imports (SYNC Firestore, STAFF wiki); 413 `PayloadTooLarge` beyond, declared or chunked. Only a declared `Content-Length` over Bun's ceiling (68 MiB, `SERVER_MAX_BODY_BYTES`) gets Bun's own empty 413 | `request-body-size.contract.test.ts` |
| Allowlist | checked only by the URL rules, so a de-allowlisted STAFF member or org admin kept the role-gated reads under the GET permitAll prefixes until the JWT expired | a JWT or API key that fails the allowlist is anonymous on a public route | `allowlist-public-reads.contract.test.ts` |
| Content negotiation | the `produces = text/html` previews answered 406 `NotAcceptable` before the handler (kept); on other routes an Accept without JSON reached Boot's `/error` dispatch: 401 for anonymous callers (public reads and health included), a whitelabel 500, or a 406 after a POST had already written | only the two HTML previews negotiate (406 JSON when the Accept admits JSON, else empty, `Accept: text/html`); every other route ignores Accept | `accept-negotiation.contract.test.ts` |
| Mail OAuth state | HMAC-bound to user and org only: an org admin could send the consent URL to someone else | also bound to the browser by the `ceitba_mail_oauth_nonce` cookie (HttpOnly, `Path` = the path of `GOOGLE_MAIL_REDIRECT_URI`) | `mail-oauth-binding.contract.test.ts` |
| Foreign errors | (n/a) | only the app's own errors carry their message; any other error is the generic 500 | `test/http/errors.test.ts` |
| Secrets in logs | (n/a) | the ITBA token is masked in error messages; logged errors lose URL query strings | `test/itba/ItbaTokenRedaction.test.ts` |
| Timestamp precision | on Linux (production) the JVM clock has nanosecond resolution, so timestamps computed in memory (`Instant.now()`, `OffsetDateTime.now(clock)`) printed up to 9 fraction digits (`...05.626702593-03:00`); values read back from Postgres had at most 6; on macOS the JVM clock is microsecond, which is why local runs never showed 9 | at most 6 digits everywhere (Postgres precision). Clients already received both 3- and 6-digit forms; JS `Date` and Dart `DateTime.parse` accept any length | contract tests accept 1 to 9 digits on both targets (`health-and-error`, `media-endpoints`, `studygroup-controller`, `share-sessions`, `proposal-controller`, `correction-schedule`) |
| Wiki pipeline restart-loop guard | every startup counted a resume of each RUNNING run, so blue/green deploys and clean restarts added up and failed a run ("detenida tras reinicios repetidos") | only a startup that finds the run still leased counts; a lease release restores the counter to its value when the lease was taken; on SIGTERM the engine stops starting work and releases its leases (`docs/SUBJECT-WIKI-PIPELINE.md` "Restart-loop guard") | `test/kb-pipeline/ResumeGuard.test.ts` |
