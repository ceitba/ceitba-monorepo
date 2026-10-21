# Serialization rules (Jackson / Hibernate parity)

Every rule below was verified against the Java API, not taken from documentation: by running the jar
(`apps/api/target/ceitba-api-1.0.0.jar`, Spring Boot 3.3.5, Jackson 2.17.2, Hibernate 6) on a migrated
database and reading its HTTP output, and by running Jackson directly (`jshell`-style, with the jars from
`BOOT-INF/lib`). The executable versions of these checks are `test/lib/serialization.test.ts` (unit) and the
contract suite (`contract/tests/*`, byte-level `r.text` assertions), which pass against both servers.

Helpers live in `src/lib/time.ts` and `src/lib/json.ts`. Responses go through `json()` / a returned value in
`src/http/router.ts`, which writes `toJavaJson(body)` with `Content-Type: application/json` (no charset, like
Spring).

## Objects

| Java | JSON | TS |
|---|---|---|
| record / DTO | keys in **component declaration order** | build the object literal in the same order |
| `null` field | present as `null` (no `NON_NULL` inclusion), except DTOs annotated `@JsonInclude(NON_NULL)` | write `null`; omit only where Java has `@JsonInclude` |
| `@JsonProperty("file_number")` | the annotated name | use that key |
| `@JsonProperty("isX")` on a record component | written **after all other components**, not in declaration order (verified with `StudyGroupResponse` on the jar) | put those keys last |
| `Map.of(...)` (HealthController) | **no stable order** (Java randomizes per JVM) | any order; tests and the diff runner sort these keys |
| `LinkedHashMap` / `TreeMap` | insertion / sorted order | same |
| enum | `name()` (upper case) unless the DTO maps it | same string |
| `UUID` | lower-case canonical string | Postgres returns lower-case |

## Numbers

| Java | Example JSON | TS |
|---|---|---|
| `int`/`Integer`/`long`/`Long` (incl. `BIGINT` ids, `count(*)`) | `42` | int8 is parsed to a JS number by the db client (`src/db/client.ts`), JSON number |
| `double`/`Double` | `1.0`, `0.1`, `1.0E20`, `1.5E-7`, `1234567.0`, `1.2345678E7` | `javaDouble(n)` (Double.toString via `JSON.rawJSON`); a plain JS number would print `1` |
| `float`/`Float` | Float.toString digits (`0.1`) | `javaFloat(n)` |
| `BigDecimal` (Postgres `numeric`) | the exact decimal text, scale kept: `5.00`; scientific when BigDecimal.toString uses it (`0.0000001` -> `1E-7`) | numeric stays a string from the driver; `bigDecimal(str)` |
| `NaN` / infinities | `"NaN"`, `"Infinity"` (quoted) | `javaDouble` does it |

## Dates and times

Instants are handled as integer microseconds since the epoch (`Micros`): Postgres and `Instant.now()` both
have microsecond precision, and JS `Date` (milliseconds) would lose digits.

| Java type and origin | JSON | TS |
|---|---|---|
| `Instant` (`ErrorResponse.timestamp`, `TokenResponse.*ExpiresAt`, `Instant.now()`) | `ISO_INSTANT`: UTC `Z`, fraction in groups of **3**: `2026-01-02T03:04:05Z`, `...05.500Z`, `...05.123400Z`, `...05.348917Z` | `formatInstant(us)` |
| `OffsetDateTime` **read from the database** (Hibernate maps every `TIMESTAMPTZ`; it normalizes to UTC) | `ISO_OFFSET_DATE_TIME`: `Z`, seconds always, fraction with trailing zeros **stripped**: `2026-01-02T03:04:05.5Z`, `2026-01-02T03:04:00Z`, `...05.123456Z` | `formatOffsetDateTime(parsePgTimestamp(row.col))` |
| `OffsetDateTime` **computed in Java** (`OffsetDateTime.now()`, `now(clock)`, `now().plusDays(n)`) | the JVM/clock zone offset (ART in prod): `2027-10-20T19:40:05.442228-03:00` | `formatOffsetDateTime(us, config.server.timeZone)` (or `ART` for `now(clock)`) |
| `LocalDateTime` | `2026-01-02T03:04:05.5`, `2026-01-02T03:04:00` | `formatLocalDateTime(us, zone)` |
| `LocalDate` (Postgres `date`) | `YYYY-MM-DD` | the driver returns the text as is |
| `LocalTime` (Postgres `time`) | read through `java.sql.Time`: **milliseconds, truncated**, then `ISO_LOCAL_TIME` (seconds always, trailing zeros stripped): `09:00` -> `09:00:00`, `18:30:15.500` -> `18:30:15.5`, `23:59:59.999999` -> `23:59:59.999`, `12:00:00.000100` -> `12:00:00` | `formatPgTime(row.col)`. Never convert a TIME to `Date` (the `LocalTemporalZoneIT` bug class) |
| `Duration` | ISO-8601 (`PT15M`, Spring Boot disables `WRITE_DURATIONS_AS_TIMESTAMPS`) | build the ISO string |
| JWT messages (`Jwt expired at ...`) | `Instant.toString()` | `instantOfEpochSecond(s)` |

The "from the database vs computed" split is the one rule features get wrong most easily: the **same column**
prints `...Z` when the DTO is built from a row Hibernate loaded, and `...-03:00` when the DTO is built from the
entity Java just created in memory (e.g. `ApiKeyCreatedResponse.expiresAt` vs `ApiKeyResponse.expiresAt`). Read
the Java service to see which one it returns.

The db client opens sessions with `TimeZone` = the JVM default zone (`TZ`, ART in production), like the JDBC
driver does, so `current_date`, `now()::date` and timestamp text behave the same in native queries.

## Strings

- Non-ASCII is written raw (UTF-8), like Jackson.
- Control characters are `\u00XX` escapes with **upper-case** hex in Jackson (`\u001F`); `toJavaJson` upper-cases
  JS's lower-case escapes.

## Request bodies (binding)

`src/http/validation.ts` (`jv.*`) reproduces Jackson's lenient binding (Spring Boot defaults) and Bean
Validation, verified on the jar:

- `{"id": 123, "name": true}` binds to Strings `"123"` / `"true"` (scalar coercion); numeric strings bind to
  numbers, floats truncate to ints, `""` binds to `null` for boxed numbers; unknown properties are ignored.
- Wrong shape (`[]`, `null`, an object where a scalar goes, `"abc"` for an Integer, unknown enum, bad UUID) is
  `400 BadRequest "Malformed or invalid request body"`.
- Constraint failures are `400 ValidationError "field: message; field2: message"` with Hibernate Validator's
  messages (`must not be blank`, `size must be between 0 and 25`, `must be less than or equal to 365`...),
  **in the request locale**: Spring resolves `Accept-Language` (highest q, else the JVM default `en_US`) and
  Hibernate reads `ValidationMessages_<lang>[_<COUNTRY>]` (27 bundles, generated into
  `src/lib/validationMessages.ts`): `es`/`es-AR` -> `no debe estar vacío`, `fr` -> `ne doit pas être vide`,
  an unknown language -> English. Verified on the jar (`contract/tests/validation-locale.contract.test.ts`).
  **Order**: Java takes violations from a HashSet, so with several failing fields its order is not stable;
  TS uses declaration order. Assert one violation per test, or compare as sets.
- Content type: JSON or `application/*+json`; anything else is 415 `Content-Type 'text/plain;charset=UTF-8' is not
  supported.` (Spring appends `charset=UTF-8` when the request has none); a body with no Content-Type is
  `'application/octet-stream'`; no Content-Type and no body is the 400 "required body" case.

## Headers that are not stable in Java

- `Allow` on 405 comes from a HashSet: same methods, random order. Compare as a set.
- `Map.of` bodies (`GET /api/`, `GET /api/health`): random key order.
