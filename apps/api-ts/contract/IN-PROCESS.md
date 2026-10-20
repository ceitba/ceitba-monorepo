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
| `JobLockIT` | `test/jobs/joblock.test.ts` | Calls `JobLock` directly with a second session holding the lock |
| `ShutdownDrainTest`, `HealthProbesIT` drain part | `test/http/shutdown.test.ts` | Needs to trigger shutdown and probe during the drain |
| Unit tests (`ApiKeyFilterTest`, `SafeRedirectTest`, `CookieOrHeaderBearerTokenResolverTest`, `IssuerAudienceValidatorTest`, `AuthControllerLogoutTest`, `SessionAllowlistTest`, `RateLimitFilterTest`) | `test/auth/units.test.ts`, `test/http/ratelimit.test.ts` | Unit tests of components, not ITs |

Black-box ports that need an endpoint of a feature not ported yet (`/v1/wiki/bookmarks`, `/v1/sync/all`,
`/v1/staff`, `/v1/articles`, `/v1/staff/drive/unclaimed`, `/v1/me/drive/info`) are written in full and
skipped on `CONTRACT_TARGET=ts` through `supports('METHOD /path')` until that feature lands; they run on java.
