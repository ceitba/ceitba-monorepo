package org.ceitba.api.support;

import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.annotation.MergedAnnotations;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.test.context.ContextConfigurationAttributes;
import org.springframework.test.context.ContextCustomizer;
import org.springframework.test.context.ContextCustomizerFactory;
import org.springframework.test.context.MergedContextConfiguration;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Points every {@code @SpringBootTest} context at its own fresh database on
 * {@link SharedPostgres}. Registered in {@code META-INF/spring.factories}.
 *
 * <p>The database is created per <em>context</em>, not per test class. The
 * customizer is the same (equal) for every class, so it does not take part in
 * the context cache key. IT classes with the same configuration share one
 * context and its database; {@link ResetSharedContextTestExecutionListener}
 * puts that database back to its post-startup state before each class that
 * reuses the context. The database is dropped when its context closes, and
 * a {@code spring.datasource.url} set through test properties is rejected
 * rather than silently overridden.
 *
 * <p>Previously each class registered its own database through its own
 * {@code @DynamicPropertySource} method. Spring keys the context cache on those
 * methods, so no two classes could ever share a context and every IT class
 * booted the full application (68 boots per CI run).
 */
public class ItDatabaseContextCustomizerFactory implements ContextCustomizerFactory {

    @Override
    public ContextCustomizer createContextCustomizer(Class<?> testClass,
                                                     List<ContextConfigurationAttributes> configAttributes) {
        boolean bootTest = MergedAnnotations.from(testClass, MergedAnnotations.SearchStrategy.TYPE_HIERARCHY)
            .isPresent(SpringBootTest.class);
        return bootTest ? new Customizer() : null;
    }

    private static final class Customizer implements ContextCustomizer {

        private static final Set<String> IGNORED_SOURCES = Set.of(
            StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME,
            StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME,
            // Boot's view over all the other sources.
            "configurationProperties");

        @Override
        public void customizeContext(ConfigurableApplicationContext context, MergedContextConfiguration config) {
            rejectOwnDatasource(context.getEnvironment());
            var db = SharedPostgres.newDatabase();
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("itDatabase", Map.of(
                "spring.datasource.url", db.getJdbcUrl(),
                "spring.datasource.username", db.getUsername(),
                "spring.datasource.password", db.getPassword())));
            // Registered before any bean, so it is destroyed last: after the
            // connection pool has closed. Cache eviction closes the context, so
            // only the few cached contexts keep a database on the server.
            ((DefaultListableBeanFactory) context.getBeanFactory())
                .registerDisposableBean("itDatabaseDrop", () -> SharedPostgres.dropDatabase(db));
            // The baseline is the database right after startup, before any test
            // class (or its @BeforeAll) has written to it.
            context.addApplicationListener(event -> {
                if (event instanceof ApplicationReadyEvent ready && ready.getApplicationContext() == context) {
                    ResetSharedContextTestExecutionListener.captureBaseline(context);
                }
            });
        }

        // Explicit test properties used to win over a per-class database; here
        // they would lose silently, so refuse them. Environment variables and
        // system properties (e.g. a developer's SPRING_DATASOURCE_URL) are
        // overridden, as before.
        private static void rejectOwnDatasource(ConfigurableEnvironment environment) {
            for (var source : environment.getPropertySources()) {
                if (IGNORED_SOURCES.contains(source.getName())) continue;
                if (source.containsProperty("spring.datasource.url")) {
                    throw new IllegalStateException("spring.datasource.url is set in property source '"
                        + source.getName() + "', but every @SpringBootTest gets its own database from "
                        + ItDatabaseContextCustomizerFactory.class.getSimpleName() + "; remove it");
                }
            }
        }

        // All instances are interchangeable, so they never split the cache key.
        @Override
        public boolean equals(Object other) {
            return other != null && other.getClass() == getClass();
        }

        @Override
        public int hashCode() {
            return Customizer.class.hashCode();
        }
    }
}
