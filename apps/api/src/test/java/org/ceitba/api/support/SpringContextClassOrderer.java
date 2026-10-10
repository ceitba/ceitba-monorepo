package org.ceitba.api.support;

import org.junit.jupiter.api.ClassDescriptor;
import org.junit.jupiter.api.ClassOrderer;
import org.junit.jupiter.api.ClassOrdererContext;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.annotation.MergedAnnotations;
import org.springframework.test.context.BootstrapUtils;
import org.springframework.test.context.MergedContextConfiguration;

import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;

/**
 * Runs test classes that share a Spring context back to back.
 *
 * <p>Classes are grouped by their {@link MergedContextConfiguration}, which is
 * exactly the key of Spring's context cache. Groups keep the order of their
 * first class by name, and classes keep name order within a group. With the
 * classes grouped, a context is used once and then evicted, so the cache can
 * stay small ({@code spring.test.context.cache.maxSize} in the pom) without
 * the same context being booted twice. Non-Spring classes sort first, by name.
 *
 * <p>Enabled for every test run in {@code junit-platform.properties}.
 */
public class SpringContextClassOrderer implements ClassOrderer {

    @Override
    public void orderClasses(ClassOrdererContext context) {
        Map<Object, String> groupLeader = new HashMap<>();
        Map<Class<?>, String> keyOf = new HashMap<>();
        context.getClassDescriptors().stream()
            .map(ClassDescriptor::getTestClass)
            .sorted(Comparator.comparing(Class::getName))
            .forEach(c -> {
                var config = mergedConfig(c);
                // Leader = first class (by name) with this configuration.
                var leader = config == null ? "" : groupLeader.computeIfAbsent(config, k -> c.getName());
                keyOf.put(c, leader + "\u0000" + c.getName());
            });
        context.getClassDescriptors().sort(Comparator.comparing(d -> keyOf.get(d.getTestClass())));
    }

    private static MergedContextConfiguration mergedConfig(Class<?> testClass) {
        if (!MergedAnnotations.from(testClass, MergedAnnotations.SearchStrategy.TYPE_HIERARCHY)
                .isPresent(SpringBootTest.class)) {
            return null;
        }
        try {
            return BootstrapUtils.resolveTestContextBootstrapper(testClass).buildMergedContextConfiguration();
        } catch (RuntimeException e) {
            // Ordering is only an optimization; let the real run report it.
            return null;
        }
    }
}
