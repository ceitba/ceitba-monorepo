---
name: api-endpoint
description: "Add or change a REST endpoint in apps/api end to end: route, DTO schemas, service, repo, errors, access rule, contract test, docs and the web client. Use for any new route or a change to a route's request, response, status codes or access."
---

# Add or change an API endpoint

Rules are in `apps/api/AGENTS.md` (read "Reference: the worked example" first); this is the order of work. Work
test-first (`/tdd`): the contract test in step 1 goes red before the code exists. `<area>` is the feature folder
(`apps/api/src/features/<area>/`, e.g. `correction`).

## Steps

1. **Contract test first**: `apps/api/contract/tests/<area>-<topic>.contract.test.ts` with
   `const api = useServer({ env })` (copy `contract/tests/career.contract.test.ts`). Authenticate with
   `bearer(await mintJwt({ email, name }))`, `seedStaff(api.db, email)` for STAFF, `apiKey(...)` for keys. Cover
   the happy path (byte-level `r.text` for the response shape), each error code, and access (anonymous / USER /
   STAFF as relevant). Run it: `bun contract/run.ts <area>-<topic>` from `apps/api`. Logic that needs a moved
   clock or fakes gets an in-process test in `test/<area>/` (`testApp()` from `test/support/app.ts`).
2. **DTOs** in `dto.ts`: request schemas with `jv.*` (validation), response interfaces in JSON key order.
   Responses never expose rows.
3. **Route** in `routes.ts`: `r.get|post|...('/v1/...', { tags, summary, params, query, body, status,
   currentUser }, handler)`; a header comment points at the feature doc.
4. **Service** in `service.ts`: business rules inside `withTx` (`{ readOnly: true }` on reads), time from
   `deps.clock`. Map rows to DTOs here; rows never reach the route.
5. **Repo** in `repo.ts` (drizzle; sort in SQL). Schema change → `flyway-migration` skill.
6. **Errors**: throw a `src/http/errors.ts` class or a feature `CodedError` subclass; a new class gets its
   mapping covered in `test/http/errors.test.ts`. Never build an error `Response` by hand.
7. **Access**: routes are authenticated + allowlisted by default. A public, STAFF, MODERATOR or SYNC route needs its
   rule in `src/http/auth/policy.ts` (`URL_RULES` and/or a `METHOD_RULES` entry keyed `"METHOD /v1/path"`; read
   `docs/AUTH-AND-ROLES.md` first), and the policy snapshot `test/fixtures/java-security-policy.json` gets the same
   change (`test/http/policy-coverage.test.ts`). Any change here goes to the `security-reviewer` subagent.
8. **Living docs** (`spec-sync`): update the feature doc in `apps/api/docs/` and the endpoint table in
   `apps/api/README.md` if the route is listed there.
9. **Web client**: add the call to `apps/web/src/api/<feature>.ts` (or `src/<section>/api/<feature>.ts` for a section) on top of `apiGet`/`apiSend` from `@/api/client`, with
   `ApiError` codes matching the API's `error` values. Mobile parity lives in `ceitba/CEITBApp`: open an issue there
   if the app needs it.
10. **Verify** from `apps/api`: `bun run build`, `bun run test`, `bun contract/run.ts` (the whole suite) and
    `bun contract/coverage.ts` (the new route has a handler and a contract hit); for the web app, `bun run lint`
    and `bun run build`.

Done when the contract test is green, every new error is mapped, access is explicit, docs and client are updated.

Then run the `api-architecture-reviewer` subagent on the diff.
