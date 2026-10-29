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

## Load test

Measured on 2026-10-21 on the same machine, for phase 5 of `api-bun-rewrite.md`: "Load test the 10 hottest
routes; p95 must not regress against Java." Java is the last Java commit, `b515215` (`origin/main`). Bun is
`feat/api-bun` at `5424e22`: the image was built at 07:22, before any later commit on the branch. Later commits
before this doc changed 7 files under the measured features, `news/routes.ts` among them; none touch the plan
subjects path. The script is `scripts/bench/load.ts`; it has the seed, the routes, the runner and the
comparison.

`GET /v1/plans/{planId}/subjects` was re-measured the same day after its N+1 was fixed (`5814256`): Bun from
`feat/api-bun` at `c25a487`, Java from the same `b515215` jar ("Re-run after the N+1 fix" below).

**Verdict: met.** The p95 does not regress on any of the 12 routes:
- All 12 routes have a lower p95 on Bun, by 15% to 98%.
- `GET /v1/plans/{planId}/subjects`, the one regression of the first run (+49%, 81 → 121 ms), is now 76 → 15 ms
  (-80%) after the N+1 fix.
- Bun has a higher p50 on 9 routes and a lower req/s on 7.

Both containers ran under a 2-CPU quota (`--cpus 2`). Most of Bun's p95 wins come from Java's 60 to 90 ms tail
floor, which is CPU-quota throttling (Findings).

The production VPS has **2 vCPUs and 4 GB of RAM** in total, so this quota is not artificial: it is the whole
machine. Production sets no per-container CPU limit, but the API shares those 2 vCPUs with Postgres, MinIO,
Caddy and the `ceitba-embeddings` service (llama.cpp, 2 threads). Under load the JVM's threads contend for the
same 2 CPUs the test gave them, and also with everything else. These results are therefore representative of
production, or optimistic for Java. The regression does not depend on the quota.

### Setup

- **Containers.** Java runs the jar in `eclipse-temurin:21-jre` with `--memory 2g --cpus 2` and
  `JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError`, as in production, with the default JIT.
  Bun runs the image from `apps/api/Dockerfile` with `--memory 1g --cpus 2`.
- **Configuration.** Both use the prod profile and the same env:
  - fakes on: `ITBA_API_USE_FAKE`, `KB_LLM_USE_FAKE`, `KB_EMBEDDING_USE_FAKE`;
  - `MAIL_ENABLED=false` and `RATE_LIMIT_ENABLED=false`;
  - Flyway off, and every writing job off (`SYNC_ENABLED`, `DIGEST_JOBS_ENABLED`, `EVENT_REMINDERS_ENABLED`,
    `ORG_MAIL_JOBS_ENABLED`, `KB_EMBEDDINGS_ENABLED`, `KB_PIPELINE_BACKGROUND`, `DRIVE_SYNC_ENABLED`), so the data
    cannot change during a run. Row counts were checked after every run.
  - Both pools are 20 connections, the shipping default (Hikari, and `DB_POOL_SIZE` in Bun).
- **Database.** One `pgvector/pgvector:0.8.6-pg16-bookworm` container (`--cpus 4 --memory 2g`).
  - The schema was migrated once and seeded once with `load.ts seed`. Each run got a fresh
    `CREATE DATABASE … TEMPLATE` clone, so every run starts from the same data.
  - The seed holds:
    - academic data: 72 plans, 1,000 subjects, 2,432 plan-subject rows, 6,000 commissions (two terms) and 12,000
      weekly slots;
    - news: 50 organizations, 2,000 articles, 20,000 vote records, 1,000 events and 5,000 RSVPs;
    - people: 5,000 users, 14,800 follows and 4,000 saved schedules;
    - wiki: 3,000 published drive files, 2,200 wiki pages, 1,800 links and 8,800 chunks with random 768-d vectors
      in an HNSW index.
- **Load generator.** `load.ts run` runs in an `oven/bun` container on the same Docker network (`--cpus 2`), not
  through Docker Desktop's port forwarder. It never used more than 47% CPU, so it was not the bottleneck.
  - It runs a closed loop of **32 keep-alive workers per route**, one route at a time.
  - A preflight checks every route on both servers first: 200, a non-empty body, and identical response sizes on
    both servers.
  - Each route gets a warm-up, then 30 s of measurement. Percentiles come from every sample. Zero errors in every
    run.
- **Warm-up.** Bun gets 10 s per route. Java gets 30 s per route, after a 30 s round-robin over all routes. Java's
  JIT needs the longer warm-up, which favours Java.
- **Runs.** Two passes in opposite order: Java then Bun, then Bun then Java. The table averages the two; the
  "per pass" column shows the spread.
- **Session.** Authenticated routes send a `ceitba_session` cookie. It carries an HS256 JWT (`BENCH_JWT_SECRET`, set to the contract `TEST_JWT_SECRET` that both servers had as `AUTH_JWT_SECRET`) minted like
  `contract/support/identity.ts`, for a seeded user with an `apuntes` grant, so no row is created on the first
  request.

### Results

Times are in ms, averaged over the two passes.

| Route | p50 Java / Bun | p95 Java / Bun | p99 Java / Bun | req/s Java / Bun | errors J / B | p95 per pass (Java; Bun) | p95 Bun vs Java |
|---|---|---|---|---|---|---|---|
| `GET /v1/careers` | 1.1 / 2.9 | 7.1 / 5.3 | 65.3 / 8.6 | 9246 / 10000 | 0 / 0 | 8.5, 5.7; 5.3, 5.2 | -26% |
| `GET /v1/plans/BP-S-1/subjects` (re-run) | 9.0 / 10.2 | 75.8 / 15.2 | 86.3 / 19.6 | 1524 / 2985 | 0 / 0 | 76.9, 74.8; 15.2, 15.1 | -80% |
| `GET /v1/commissions?plan=BP-S-1` | 70.0 / 82.4 | 141 / 119 | 230 / 156 | 515 / 375 | 0 / 0 | 174, 108; 133, 106 | -15% |
| `GET /v1/articles` (pages 1–5) | 9.4 / 26.7 | 55.6 / 42.6 | 68.8 / 64.0 | 1959 / 1118 | 0 / 0 | 57.3, 53.9; 49.3, 36.0 | -23% |
| `GET /v1/articles/{id}` (rotated) | 1.5 / 5.0 | 12.1 / 9.5 | 67.2 / 15.4 | 7223 / 5816 | 0 / 0 | 15.0, 9.2; 10.3, 8.7 | -22% |
| `GET /v1/news/events` | 4.6 / 19.8 | 60.9 / 30.5 | 72.4 / 43.7 | 2881 / 1513 | 0 / 0 | 61.9, 59.9; 33.7, 27.4 | -50% |
| `GET /v1/organizations` | 33.1 / 14.0 | 80.9 / 23.2 | 101 / 34.3 | 742 / 2090 | 0 / 0 | 83.0, 78.9; 24.5, 21.9 | -71% |
| `GET /v1/auth/me` (cookie) | 4.0 / 17.6 | 71.4 / 32.4 | 81.8 / 46.5 | 2552 / 1628 | 0 / 0 | 72.1, 70.7; 31.1, 33.6 | -55% |
| `GET /v1/me/schedules` (5 saved) | 2.7 / 16.3 | 63.7 / 36.3 | 76.7 / 62.2 | 3673 / 1663 | 0 / 0 | 64.6, 62.8; 28.2, 44.4 | -43% |
| `GET /v1/classrooms/availability?day=MONDAY&at=10:00` | 609 / 228 | 1230 / 284 | 1644 / 375 | 50 / 153 | 0 / 0 | 898, 1562; 294, 273 | -77% |
| `GET /v1/wiki/subjects/{id}/kb/{slug}` (rotated) | 7.9 / 30.7 | 88.4 / 49.1 | 111 / 68.1 | 1345 / 974 | 0 / 0 | 96.4, 80.4; 42.2, 55.9 | -44% |
| `GET /v1/wiki/kb/search?q=…` | 1662 / 24.1 | 2706 / 44.1 | 3408 / 64.8 | 18 / 1193 | 0 / 0 | 2503, 2909; 47.2, 41.0 | -98% |

The routes are the task's list, 12 rather than 10. They are the reads `apps/web/src/api` and the mobile app call
most: the home page, the newsletter, the scheduler, the session, Apuntes and the wiki. The plan-subjects row is
from the re-run below; before the N+1 fix it was p50 11.8 / 79.7, p95 81.1 / **121**, p99 98.0 / 183 and
1246 / 378 req/s (p95 +49%).

### Re-run after the N+1 fix

Three routes, with the setup above unchanged: the same `b515215` jar (entry-for-entry identical CRCs to the first
run's), a Bun image built from `c25a487`, a fresh database migrated and seeded with `load.ts seed`, a template
clone per run, 32 workers, 30 s, the same warm-ups, two passes in opposite order, zero errors, row counts
unchanged. One difference favours Java: `--routes careers,plan-subjects,organizations` makes the 30 s prime
cycle over these three routes only, so each gets more JIT warm-up than in the 12-route run. Careers and
organizations are there to calibrate against the first run.

| Route | p50 Java / Bun | p95 Java / Bun | p99 Java / Bun | req/s Java / Bun | errors J / B | p95 per pass (Java; Bun) | p95 Bun vs Java |
|---|---|---|---|---|---|---|---|
| `GET /v1/careers` | 0.9 / 2.7 | 5.6 / 4.8 | 64.1 / 7.3 | 10875 / 10700 | 0 / 0 | 5.8, 5.4; 4.8, 4.7 | -15% |
| `GET /v1/plans/BP-S-1/subjects` | 9.0 / 10.2 | 75.8 / 15.2 | 86.3 / 19.6 | 1524 / 2985 | 0 / 0 | 76.9, 74.8; 15.2, 15.1 | -80% |
| `GET /v1/organizations` | 23.6 / 14.6 | 73.7 / 23.1 | 81.3 / 30.1 | 894 / 2054 | 0 / 0 | 73.6, 73.8; 23.2, 23.0 | -69% |

- Bun's careers and organizations numbers reproduce the first run (p95 4.8 vs 5.3 and 23.1 vs 23.2 ms). Java's
  are somewhat better (p95 5.6 vs 7.1 and 73.7 vs 80.9 ms), consistent with the longer per-route priming, and the
  same 60 to 90 ms tail floor is still there.
- Plan subjects on Bun went from p50 79.7 to 10.2 ms and from 378 to 2985 req/s: one query instead of 65 round
  trips per request, so it is no longer capped by the pool. It now serves about twice Java's req/s.

### Findings

- **The one regression was an N+1, fixed in `5814256`.**
  - `PlanService.toResponses` (`apps/api/src/features/plan/service.ts`) awaited `repo.findSubject` once per row,
    one after another. For a 64-subject plan that is 65 round trips per request.
  - The cap came from the pool. Each request held one of the 20 connections inside `withTx` for the 65
    sequential round trips. Throughput was about 20 / (65 × RTT): with a round trip of about 0.8 ms that is about
    385 req/s, which matches the 378 measured. Java has the same N+1 but finishes each round trip faster.
  - The fix loads the subjects in one query (`planRepo.findSubjectsByIds`, as the commission service does). The
    re-run above measures it: p95 121 → 15 ms, which closes the phase 5 item.
- **Bun's p50 is higher, its tail much shorter.**
  - Bun is one JS thread: about 107% CPU on average, 136% at peak, of a 2-CPU quota.
  - Java uses the whole quota (about 186%) and so has a lower median and more req/s on the cheap routes.
  - But Java's p95 sits on a 60 to 90 ms floor even for `/auth/me`. That floor is CFS quota throttling. In a 20 s
    `/auth/me` run, the container's `cpu.stat` recorded `nr_throttled` going up by 201, about once per 100 ms
    period, with 89 s of throttled thread time. The JVM runs 64 threads (Tomcat, GC, JIT) against a 2-CPU quota.
  - The tail depends on the quota. The VPS has 2 vCPUs in total, shared with Postgres, MinIO, Caddy and the
    embeddings service, so production has at most what the test gave Java (see above).
- **Java's wiki search is slow, and Bun's is not.**
  - Both run the same SQL with server-side prepared statements.
  - The generic plan of that query cannot use the HNSW index: it does a nested loop over every chunk and a top-N
    sort, 368 ms per query instead of 9.6 ms with a custom plan (`EXPLAIN ANALYZE` with `plan_cache_mode`
    forced each way).
  - The most likely cause is that PostgreSQL switched Java's sessions to that generic plan after five
    executions: Java's latency under load matches it, and Postgres was saturated during that route. This was
    not observed directly in Java's sessions.
  - Bun stayed fast under load. Why the two drivers end up with different plans was not investigated.
  - If Bun ever gets the generic plan (a driver change, or different statistics), search falls back to the Java
    numbers. Set `plan_cache_mode = force_custom_plan` in the search transaction to make it robust.
- **`classrooms/availability` is the slowest route on both.** It loads every active slot (8,000 in this seed) and
  computes availability in process. Bun is about 2.7 times faster, but at 230 ms p50 it is worth caching per
  minute.

### Memory

Sampled with `docker stats` about once per second for each whole run.

| | Java (limit 2 GiB) | Bun (limit 1 GiB) |
|---|---|---|
| After boot, before load | 644 / 664 MiB | 79 / 81 MiB |
| Peak under load, pass 1 / pass 2 | **1,839 / 1,981 MiB** | **321 / 290 MiB** |
| CPU under load, avg / max | 186% / 227% | 107% / 136% |
| Postgres CPU under load, avg | 127–139% | 143–144% |

- Java grows its heap toward the 75% cap and keeps it. It peaked within 70 MiB of the 2 GiB limit.
- Bun peaked at 290–321 MiB under the same load, with a quarter of the headroom.

### Caveats

- **Environment.** One laptop (Apple M5, 10 cores) and the Docker Desktop Linux VM. The load generator, Postgres
  and the server share the VM. Other sessions' idle Postgres containers were running, but no other load. Absolute
  numbers will differ on the VPS; compare the ratios.
- **Synthetic load.** It hits one route at a time at a fixed concurrency of 32, not a production traffic mix.
  There is no TLS and no Caddy in front.
- **Fakes and data.** External services are faked, and the search query embedding is the fake hash embedder, so
  search time is all database. The seed is synthetic: real articles, wiki pages and plans differ in size, and
  the wiki vectors are random.
- **Single runtime process.** Bun runs one process, as in the image. Java's req/s advantage on cheap routes comes
  from using both CPUs.

### Memory budget on the VPS (4 GB total)

| | Java | Bun |
|---|---|---|
| Container limit per color | 2 GiB (heap up to 75%) | 1 GiB |
| Idle, one color | 735 MiB | 80–120 MiB |
| Peak under load | 1,839–1,981 MiB, within 70 MiB of the limit | 290–321 MiB |
| Blue/green overlap, two colors idle | ~1.5 GiB | ~0.25 GiB |

The other services on the same 4 GB are Postgres, MinIO, Caddy, the MCP server, and `ceitba-embeddings` (1 GiB
limit, about 200 MB resident). With Java, two colors under load could reach about 4 GiB of limits on their own.
With Bun, the API stops being the biggest memory consumer on the machine.

