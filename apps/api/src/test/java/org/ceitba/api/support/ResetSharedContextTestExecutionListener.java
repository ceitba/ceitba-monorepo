package org.ceitba.api.support;

import org.ceitba.api.external.drive.FakeDriveClient;
import org.ceitba.api.external.itba.FakeItbaApiClient;
import org.ceitba.api.external.llm.FakeDoModelCatalog;
import org.ceitba.api.external.llm.FakeLlmBatchClient;
import org.ceitba.api.external.llm.FakeSyncChatClient;
import org.ceitba.api.service.media.InMemoryObjectStorage;
import org.ceitba.api.service.push.FakePushGateway;
import org.ceitba.api.service.digest.DigestTrackingService;
import org.ceitba.api.service.drive.DriveSyncService;
import org.ceitba.api.service.kb.llm.KbEndpointRegistry;
import org.ceitba.api.service.kb.pipeline.KbRunEngine;
import org.ceitba.api.service.ratelimit.UserRateLimiter;
import org.ceitba.api.external.llm.DoQuotaTracker;
import com.github.benmanes.caffeine.cache.Cache;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.MergedAnnotations;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestContext;
import org.springframework.test.context.support.AbstractTestExecutionListener;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

import javax.sql.DataSource;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Gives every IT class the state it used to get from a brand-new context and
 * database, while the context itself is reused across classes.
 *
 * <p>When a context finishes starting, {@link ItDatabaseContextCustomizerFactory}
 * has this listener record a baseline: which tables hold rows (Flyway seeds,
 * e.g. {@code wiki.kb_model}, plus anything written at startup) and every
 * sequence's position. The first class to use a context sees it exactly as
 * started. Before each later class that reuses the context, it:
 * <ol>
 *   <li>waits for {@code @Async}/{@code @Scheduled} work left over from the
 *       previous class to finish,</li>
 *   <li>truncates every table (except Flyway's history), restores the
 *       baseline rows and rewinds the sequences,</li>
 *   <li>resets the in-memory fakes (push gateway, object storage, ITBA, Drive
 *       and LLM fakes) and the in-memory state of singleton services (rate-limit
 *       buckets, quota and run bookkeeping) that would otherwise carry over.</li>
 * </ol>
 * Registered in {@code META-INF/spring.factories}. The reset runs in
 * {@code beforeTestClass}, before the class's {@code @BeforeAll} methods, so
 * data they seed survives; it only touches a context that is already running,
 * so a class whose context is not cached yet (LocalTemporalZoneIT) can still
 * set things up in {@code @BeforeAll} before its context starts.
 */
public class ResetSharedContextTestExecutionListener extends AbstractTestExecutionListener {

    static final String BASELINE_SCHEMA = "it_baseline";

    private static final Map<ApplicationContext, Baseline> BASELINES =
        Collections.synchronizedMap(new WeakHashMap<>());
    // Last class that ran on each context, named when its leftovers break the next one.
    private static final Map<ApplicationContext, String> LAST_CLASS =
        Collections.synchronizedMap(new WeakHashMap<>());

    @Override
    public int getOrder() {
        // After DirtiesContextBeforeModesTestExecutionListener (1500), so a
        // context dirtied before the class is not reset only to be discarded.
        return 1900;
    }

    static void captureBaseline(ApplicationContext context) {
        context.getBeanProvider(DataSource.class)
            .ifAvailable(dataSource -> BASELINES.put(context, Baseline.capture(dataSource)));
    }

    @Override
    public void beforeTestClass(TestContext testContext) {
        if (!applies(testContext) || !testContext.hasApplicationContext()) {
            // Not started yet: this class gets it fresh.
            return;
        }
        var context = testContext.getApplicationContext();
        var dataSource = context.getBeanProvider(DataSource.class).getIfAvailable();
        if (dataSource == null) return;
        var baseline = BASELINES.get(context);
        if (baseline == null) {
            throw new IllegalStateException("No baseline was recorded when the context of "
                + testContext.getTestClass().getName() + " started");
        }
        var previous = LAST_CLASS.get(context);
        AsyncWork.awaitIdle(context, previous);
        try {
            baseline.restore(dataSource);
        } catch (RuntimeException e) {
            throw new IllegalStateException("Could not reset the database after " + previous, e);
        }
        resetFakes(context);
        resetServices(context);
    }

    @Override
    public void afterTestClass(TestContext testContext) {
        // A context closed by @DirtiesContext is already gone here.
        if (applies(testContext) && testContext.hasApplicationContext()) {
            LAST_CLASS.put(testContext.getApplicationContext(), testContext.getTestClass().getName());
        }
    }

    private static boolean applies(TestContext testContext) {
        var testClass = testContext.getTestClass();
        return isSpringBootTest(testClass) && !isInnerClass(testClass);
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

    private static void resetFakes(ApplicationContext context) {
        context.getBeanProvider(FakePushGateway.class).ifAvailable(FakePushGateway::reset);
        context.getBeanProvider(InMemoryObjectStorage.class).ifAvailable(InMemoryObjectStorage::clear);
        context.getBeanProvider(FakeItbaApiClient.class).ifAvailable(FakeItbaApiClient::reset);
        context.getBeanProvider(FakeDriveClient.class).ifAvailable(FakeDriveClient::reset);
        context.getBeanProvider(FakeLlmBatchClient.class).ifAvailable(FakeLlmBatchClient::reset);
        context.getBeanProvider(FakeSyncChatClient.class).ifAvailable(FakeSyncChatClient::reset);
        context.getBeanProvider(FakeDoModelCatalog.class).ifAvailable(c -> c.items(null));
    }

    // In-memory state of production singletons, cleared field by field (named
    // explicitly, so a rename fails here rather than leaking state). Every
    // MockMvc request comes from 127.0.0.1 and ids restart with the sequences,
    // so e.g. rate-limit buckets would otherwise be shared between classes.
    // (RateLimitFilter is not a bean; rate limiting is off except in
    // RateLimitIT, which has its own context.)
    private static void resetServices(ApplicationContext context) {
        clear(context, DigestTrackingService.class, "clientBuckets", "trackingBuckets");
        clear(context, UserRateLimiter.class, "buckets");
        clear(context, DoQuotaTracker.class, "counters", "observedAt", "retryAfterSec", "lastProbe");
        clear(context, KbRunEngine.class, "again", "quotaPausedUntil", "stepFailures");
        clear(context, KbEndpointRegistry.class, "built", "counters");
        clear(context, DriveSyncService.class, "inProgress");
    }

    private static void clear(ApplicationContext context, Class<?> type, String... fields) {
        context.getBeanProvider(type).stream().map(AopTestUtils::getUltimateTargetObject).forEach(bean -> {
            for (var field : fields) {
                switch (ReflectionTestUtils.getField(bean, field)) {
                    case Cache<?, ?> cache -> cache.invalidateAll();
                    case Map<?, ?> map -> map.clear();
                    case Collection<?> collection -> collection.clear();
                    case AtomicReference<?> ref -> ref.set(null);
                    case null -> { }
                    default -> ReflectionTestUtils.setField(bean, field, null);
                }
            }
        });
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
                  AND c.relpersistence <> 't'
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
                  AND schemaname NOT LIKE 'pg\\_temp\\_%'
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
