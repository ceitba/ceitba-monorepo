# Java API baseline (before the Bun rewrite)

Measured on 2026-10-20 to compare against the Bun service later (`docs/plans/api-bun-rewrite.md`). Rerun the
same steps on the same machine for the Bun numbers.

## Machine

- Apple M5, 10 cores, 16 GB RAM, macOS.
- Docker 29.2.0.
- Temurin JDK 21.0.12, the same major version as CI. JDK 26 breaks Mockito inline mocks: 55 unit tests fail.

## Full test suite

Command: `./mvnw -B -ntp clean verify`. This is CI's command, run with a warm `~/.m2` and the Testcontainers
image already pulled; no image was pulled during the run.

| Metric | Value |
|---|---|
| Wall time, whole build | **122 s** (`real`); 204 s user CPU, 16 s sys |
| Tests | 1304 green: 628 unit (Surefire) + 676 integration (Failsafe) |
| Compile (`clean test-compile`) | ~6 s |
| Unit tests (`surefire:test`) | ~6 s; the sum of class times is 4.6 s |
| Integration tests + packaging | ~108 s; the sum of IT class times is 107 s |

`/usr/bin/time` reported a 2.0 GB max RSS, but that covers one process tree only. It excludes the Postgres
container, so it is not the suite's total memory.

## Idle server

Setup:
- The built jar runs in `eclipse-temurin:21-jre` with `--memory 2g` and
  `JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError`, as in production.
- `SPRING_PROFILES_ACTIVE=prod`, Postgres from `pgvector/pgvector:0.8.6-pg16-bookworm`.
- `ITBA_API_USE_FAKE`, `KB_LLM_USE_FAKE` and `KB_EMBEDDING_USE_FAKE` are `true`; `MAIL_ENABLED=false`.
- No MinIO, no embeddings service. Scheduled jobs run with their defaults.

Sampling: `scripts/bench/idle-stats.sh bench-java 300 out.csv`, 60 s after boot, with no traffic. That is 150
`docker stats` samples over 5 minutes.

| Metric | Value |
|---|---|
| Boot to healthy | 10 s wall; Spring reports "Started in 8.0 s", including Flyway on an empty DB |
| CPU, idle | avg **0.50%**, p95 0.81%, max 11.1% (a scheduled tick) |
| RAM, idle | avg **735 MiB**, min 734, max 738 |
| Routes | 295 operations on 225 paths (`/api/docs.json`) |

Idle RAM on the JVM mostly reflects heap sizing, so the number is not the live data size. With a 2 GB limit and
`MaxRAMPercentage=75`, the JVM may grow the heap up to about 1.5 GB, and after boot it keeps the heap it has
committed. Compare it with the Bun process's RSS under the same 2 GB limit, and treat it as "what the container
costs", not as "memory needed".

## Bun results (2026-10-21, same machine)

The Bun service is measured on the same machine as Java. Commit `3593ded` on `feat/api-bun`.

### Test suite

| | Java | Bun |
|---|---|---|
| Command | `./mvnw -B -ntp clean verify` | `bun run build && bun run test && bun contract/run.ts --target ts` |
| Wall time | **122 s** | **66 s** |
| Compile / type-check | ~6 s | 4 s (`tsc`) |
| Unit + in-process | ~6 s (628 tests) | 42 s (1050 tests, many DB-backed in-process ports of ITs) |
| Integration / contract | ~108 s (676 ITs, one shared Spring context) | 19 s (725 black-box HTTP tests, 3 workers, one fresh server per file: 87 boots of about 0.25 s) |

The numbers are not like for like:
- The suites are cut differently. Every Java test has a TS counterpart (`contract/parity.ts`: 1201 of 1204 matched,
  3 excluded with reasons). Many ITs became both a black-box contract test and an in-process test.
- The contract suite runs files in parallel. Maven ran the ITs serially in one JVM.
- The same 725 contract tests against the Java jar take 252 s, mostly booting the jar (7.3 s on average).

### Idle server

Same conditions as Java:
- `--memory 2g`, prod profile, fresh `pgvector` Postgres;
- `ITBA_API_USE_FAKE`, `KB_LLM_USE_FAKE` and `KB_EMBEDDING_USE_FAKE` are `true`; `MAIL_ENABLED=false`;
- image `apps/api-ts/Dockerfile` (`oven/bun:1.4.2-alpine`);
- 60 s settle, then 300 s of `scripts/bench/idle-stats.sh`.

| | Java | Bun |
|---|---|---|
| Boot to healthy, including all 64 migrations on an empty DB | 10 s | **≈1 s** |
| CPU idle, avg / p95 / max | 0.50% / 0.81% / 11.1% | 0.59% / 1.76% / 5.8% |
| RAM idle, avg (min to max) | **735 MiB** (734 to 738) | **120 MiB** (119 to 126) |

These numbers are what the container costs, not what the app needs:
- Java holds its committed heap and a warm 20-connection Hikari pool.
- Bun's pool opens connections lazily.

Idle CPU is noise-level on both. The scheduled jobs tick on both (digest tick, embeddings sweep, org mail).
