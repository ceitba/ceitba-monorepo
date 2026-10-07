package org.ceitba.api.support;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.annotation.MergedAnnotations;
import org.springframework.core.env.MapPropertySource;
import org.springframework.test.context.ContextConfigurationAttributes;
import org.springframework.test.context.ContextCustomizer;
import org.springframework.test.context.ContextCustomizerFactory;
import org.springframework.test.context.MergedContextConfiguration;

import java.util.List;
import java.util.Map;

/**
 * Points every {@code @SpringBootTest} context at its own fresh database on
 * {@link SharedPostgres}. Registered in {@code META-INF/spring.factories}.
 *
 * <p>The database is created per <em>context</em>, not per test class. The
 * customizer is the same (equal) for every class, so it does not take part in
 * the context cache key. IT classes with the same configuration share one
 * context and its database; {@link ResetSharedContextTestExecutionListener}
 * puts that database back to its post-startup state before each class that
 * reuses the context.
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

        @Override
        public void customizeContext(ConfigurableApplicationContext context, MergedContextConfiguration config) {
            var db = SharedPostgres.newDatabase();
            // addFirst: a class-level @DynamicPropertySource (applied later,
            // also addFirst) can still override it, as MinioPresignedUploadIT
            // used to; nothing does today.
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("itDatabase", Map.of(
                "spring.datasource.url", db.getJdbcUrl(),
                "spring.datasource.username", db.getUsername(),
                "spring.datasource.password", db.getPassword())));
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
