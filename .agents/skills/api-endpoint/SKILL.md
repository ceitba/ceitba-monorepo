---
name: api-endpoint
description: "Add or change a REST endpoint in apps/api end to end: controller, DTO records, service, repository, exceptions, security matcher, integration test, docs and the SPA client. Use for any new route or a change to a route's request, response, status codes or access."
---

# Add or change an API endpoint

Rules are in `apps/api/AGENTS.md`; this is the order of work. Work test-first (`/tdd`): the IT in step 1 goes red
before the code exists. `<feature>` is the package name shared across layers (e.g. `correction`).

## Steps

1. **Integration test first**: `src/test/java/org/ceitba/api/web/<feature>/<Name>IT.java` with `@SpringBootTest`,
   `@AutoConfigureMockMvc` and `static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();`
   (copy the `@DynamicPropertySource` block from `web/correction/ScheduleCorrectionIT`). Authenticate with
   `SecurityMockMvcRequestPostProcessors.jwt()` carrying `email`/`name` claims and the needed authorities. Cover the
   happy path, each error code, and access (anonymous / USER / STAFF as relevant).
2. **DTOs**: request/response `record`s in `web/<feature>/dto/` with Bean Validation annotations. Responses never
   expose entities.
3. **Controller** in `web/<feature>/`: constructor injection, `@Tag`, `@Operation(summary=…)`, full `/v1/...` path
   per method, `@Valid @RequestBody`, `@CurrentUser User` for the caller, `@SecurityRequirement(name="bearerAuth")`
   unless public. A header comment points at the feature doc.
4. **Service** in `service/<feature>/`: business rules, `@Transactional(readOnly = true)` on reads, `@Transactional`
   on writes, time from the injected `Clock`. Map entities to DTOs here or in the controller from service-returned
   views, never let entities reach the web layer.
5. **Repository** in `repository/<feature>/` (Spring Data). Schema change → `flyway-migration` skill.
6. **Errors**: throw a `common/exception/*` type or a new feature exception in `service/<feature>/`. A new exception
   type gets an `@ExceptionHandler` in `web/error/GlobalExceptionHandler` returning `ErrorResponse`. Never
   `ResponseStatusException`.
7. **Access**: routes are authenticated + allowlisted by default. Public, STAFF, MODERATOR or SYNC routes need an
   explicit matcher in `config/SecurityConfig` (read `docs/AUTH-AND-ROLES.md` first). Any change here goes to the
   `security-reviewer` subagent.
8. **Living docs** (`spec-sync`): update the feature doc in `apps/api/docs/` and the endpoint table in
   `apps/api/README.md` if the route is listed there.
9. **SPA client**: add the call to the consuming app's `src/api/<feature>.ts|js` on top of `apiGet`/`apiSend`, with
   `ApiError` codes matching the API's `error` values. Mobile parity lives in `ceitba/CEITBApp`: open an issue there
   if the app needs it.
10. **Verify**: `./mvnw -B -ntp verify`; for the SPA, `bun run --filter @ceitba/<app> lint` and `build`.

Done when the IT is green, every new error has a handler, access is explicit, docs and client are updated.

Then run the `api-architecture-reviewer` subagent on the diff.
