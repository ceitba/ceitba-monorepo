package org.ceitba.api.support;

import org.ceitba.api.external.drive.FakeDriveClient;
import org.ceitba.api.external.itba.FakeItbaApiClient;
import org.ceitba.api.external.llm.FakeDoModelCatalog;
import org.ceitba.api.external.llm.FakeLlmBatchClient;
import org.ceitba.api.external.llm.FakeSyncChatClient;
import org.ceitba.api.service.media.InMemoryObjectStorage;
import org.ceitba.api.service.push.FakePushGateway;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.MergedAnnotations;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.TestContext;
import org.springframework.test.context.support.AbstractTestExecutionListener;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

import javax.sql.DataSource;
import java.lang.reflect.Modifier;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;

/**
 * Gives every IT class the state it used to get from a brand-new context and
 * database, while the context itself is reused across classes.
 *
 * <p>The first class to use a context sees it exactly as before: just started,
 * on a fresh database. At that point this listener records a baseline: which
 * tables hold rows (Flyway seeds, e.g. {@code wiki.kb_model}, plus anything
 * written at startup) and every sequence's position. Before each later class
 * that reuses the context, it:
 * <ol>
 *   <li>waits for {@code @Async} work left over from the previous class to finish,</li>
 *   <li>truncates every table (except Flyway's history), restores the
 *       baseline rows and rewinds the sequences,</li>
 *   <li>resets the in-memory fakes (push gateway, object storage, ITBA, Drive
 *       and LLM fakes) that would otherwise carry stubs and recorded calls over.</li>
 * </ol>
 * Registered in {@code META-INF/spring.factories}; runs in
 * {@code prepareTestInstance}, i.e. after static {@code @BeforeAll} methods (so
 * LocalTemporalZoneIT can still set the zone before its context starts) and
 * before any {@code @BeforeEach}.
 */
public class ResetSharedContextTestExecutionListener extends AbstractTestExecutionListener {

    static final String BASELINE_SCHEMA = "it_baseline";
    private static final String DONE = ResetSharedContextTestExecutionListener.class.getName() + ".done";
    private static final Duration EXECUTOR_IDLE_TIMEOUT = Duration.ofSeconds(30);

    private static final Map<ApplicationContext, Baseline> BASELINES =
        Collections.synchronizedMap(new WeakHashMap<>());

    @Override
    public int getOrder() {
        // Before DependencyInjectionTestExecutionListener (2000), so nothing
        // injected into the test instance has run against stale data.
        return 1900;
    }

    @Override
    public void prepareTestInstance(TestContext testContext) {
        var testClass = testContext.getTestClass();
        if (!isSpringBootTest(testClass) || isInnerClass(testClass) || testContext.hasAttribute(DONE)) {
            return;
        }
        testContext.setAttribute(DONE, Boolean.TRUE);

        var context = testContext.getApplicationContext();
        var dataSource = context.getBeanProvider(DataSource.class).getIfAvailable();
        if (dataSource == null) return;

        var baseline = BASELINES.get(context);
        if (baseline == null) {
            BASELINES.put(context, Baseline.capture(dataSource));
            return;
        }
        awaitIdleExecutors(context);
        baseline.restore(dataSource);
        resetFakes(context);
    }

    private static boolean isSpringBootTest(Class<?> testClass) {
        return MergedAnnotations.from(testClass, MergedAnnotations.SearchStrategy.TYPE_HIERARCHY)
            .isPresent(SpringBootTest.class);
    }

    // @Nested classes share the enclosing class's context mid-run; resetting
    // there would wipe data the outer class set up.
    private static boolean isInnerClass(Class<?> testClass) {
        return testClass.getEnclosingClass() != null && !Modifier.isStatic(testClass.getModifiers());
    }

    private static void awaitIdleExecutors(ApplicationContext context) {
        long deadline = System.nanoTime() + EXECUTOR_IDLE_TIMEOUT.toNanos();
        for (var executor : context.getBeansOfType(ThreadPoolTaskExecutor.class, false, false).values()) {
            var pool = executor.getThreadPoolExecutor();
            while (pool.getActiveCount() > 0 || !pool.getQueue().isEmpty()) {
                if (System.nanoTime() > deadline) {
                    throw new IllegalStateException("Async work from the previous test class is still running on "
                        + executor.getThreadNamePrefix() + "* after " + EXECUTOR_IDLE_TIMEOUT);
                }
                try {
                    Thread.sleep(10);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(e);
                }
            }
        }
    }

    private static void resetFakes(ApplicationContext context) {
        context.getBeanProvider(FakePushGateway.class).ifAvailable(FakePushGateway::reset);
        context.getBeanProvider(InMemoryObjectStorage.class).ifAvailable(InMemoryObjectStorage::clear);
        context.getBeanProvider(FakeItbaApiClient.class).ifAvailable(FakeItbaApiClient::reset);
        context.getBeanProvider(FakeDriveClient.class).ifAvailable(FakeDriveClient::reset);
        context.getBeanProvider(FakeLlmBatchClient.class).ifAvailable(FakeLlmBatchClient::reset);
        context.getBeanProvider(FakeSyncChatClient.class).ifAvailable(FakeSyncChatClient::reset);
        context.getBeanProvider(FakeDoModelCatalog.class).ifAvailable(c -> c.items(null));
    }

    /** Post-startup database state of one context. */
    private record Baseline(List<String> tables, List<SeededTable> seeded, List<Sequence> sequences) {

        private record SeededTable(String table, String copy, String columns) {
        }

        private record Sequence(String name, Long lastValue) {
        }

        static Baseline capture(DataSource dataSource) {
            var jdbc = new JdbcTemplate(dataSource);
            var tables = jdbc.queryForList("""
                SELECT format('%I.%I', n.nspname, c.relname)
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
                  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', ?)
                  AND c.relname <> 'flyway_schema_history'
                ORDER BY 1
                """, String.class, BASELINE_SCHEMA);

            List<SeededTable> seeded = new ArrayList<>();
            for (var table : tables) {
                Boolean hasRows = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM " + table + ")", Boolean.class);
                if (!Boolean.TRUE.equals(hasRows)) continue;
                var copy = BASELINE_SCHEMA + ".t" + seeded.size();
                // Generated columns cannot be inserted into; Postgres recomputes them.
                var columns = String.join(", ", jdbc.queryForList("""
                    SELECT format('%I', a.attname)
                    FROM pg_attribute a
                    WHERE a.attrelid = ?::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
                    ORDER BY a.attnum
                    """, String.class, table));
                jdbc.execute("CREATE SCHEMA IF NOT EXISTS " + BASELINE_SCHEMA);
                jdbc.execute("CREATE TABLE " + copy + " AS SELECT " + columns + " FROM " + table);
                seeded.add(new SeededTable(table, copy, columns));
            }

            var sequences = jdbc.query("""
                SELECT format('%I.%I', schemaname, sequencename) AS name, last_value
                FROM pg_sequences
                WHERE schemaname NOT IN ('pg_catalog', 'information_schema', ?)
                ORDER BY 1
                """, (rs, i) -> new Sequence(rs.getString("name"), (Long) rs.getObject("last_value")),
                BASELINE_SCHEMA);
            return new Baseline(List.copyOf(tables), List.copyOf(seeded), List.copyOf(sequences));
        }

        void restore(DataSource dataSource) {
            if (tables.isEmpty()) return;
            var jdbc = new JdbcTemplate(dataSource);
            new TransactionTemplate(new DataSourceTransactionManager(dataSource)).executeWithoutResult(tx -> {
                // Fail loudly instead of hanging if something still holds a lock.
                jdbc.execute("SET LOCAL lock_timeout = '30s'");
                jdbc.execute("TRUNCATE TABLE " + String.join(", ", tables) + " RESTART IDENTITY CASCADE");
                if (!seeded.isEmpty()) {
                    // Seed rows may reference each other; skip FK triggers while copying back.
                    jdbc.execute("SET LOCAL session_replication_role = replica");
                    for (var s : seeded) {
                        jdbc.execute("INSERT INTO " + s.table() + " (" + s.columns() + ") OVERRIDING SYSTEM VALUE"
                            + " SELECT " + s.columns() + " FROM " + s.copy());
                    }
                    jdbc.execute("SET LOCAL session_replication_role = origin");
                }
                for (var seq : sequences) {
                    if (seq.lastValue() == null) {
                        jdbc.execute("ALTER SEQUENCE " + seq.name() + " RESTART");
                    } else {
                        jdbc.queryForObject("SELECT setval(?::regclass, ?, true)", Long.class,
                            seq.name(), seq.lastValue());
                    }
                }
            });
        }
    }
}
