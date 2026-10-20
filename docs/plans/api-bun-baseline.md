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
