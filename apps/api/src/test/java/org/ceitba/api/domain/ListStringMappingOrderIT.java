package org.ceitba.api.domain;

import org.ceitba.api.support.SharedPostgres;
import jakarta.persistence.Entity;
import org.ceitba.api.domain.news.Article;
import org.flywaydb.core.Flyway;
import org.hibernate.SessionFactory;
import org.hibernate.boot.MetadataSources;
import org.hibernate.boot.model.naming.PhysicalNamingStrategyStandardImpl;
import org.hibernate.boot.registry.StandardServiceRegistry;
import org.hibernate.boot.registry.StandardServiceRegistryBuilder;
import org.hibernate.cfg.AvailableSettings;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Regression test for a startup crash that depended on the order in which
 * Hibernate processed entity classes (i.e. the order of .class entries in the
 * packaged jar).
 *
 * <p>{@link Article} maps {@code List<String>} as JSON (jsonb) while several
 * other entities map {@code List<String>} as a Postgres array. With
 * Hibernate 6.5, when Article was processed first, the resolved JSON type for
 * {@code List<String>} leaked into the later ARRAY attributes and
 * {@code hbm2ddl.auto=validate} failed with
 * {@code found [_text (Types#ARRAY)], but expecting [text[] (Types#JSON)]}.
 *
 * <p>This bootstraps Hibernate natively (no Spring classpath scanning, whose
 * order we cannot control) against the real production migration chain, once
 * per entity ordering, with schema validation on.
 */
class ListStringMappingOrderIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    enum Order { ARTICLE_FIRST, ARTICLE_LAST, ALPHABETICAL, REVERSE_ALPHABETICAL }

    private static boolean migrated;

    private static synchronized void migrate() {
        if (migrated) return;
        Flyway.configure()
            .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
            .schemas("public", "wiki")
            .defaultSchema("public")
            .locations("classpath:db/migration")
            .outOfOrder(true)
            .load()
            .migrate();
        migrated = true;
    }

    @ParameterizedTest
    @EnumSource(Order.class)
    void schemaValidatesRegardlessOfEntityOrder(Order order) throws Exception {
        migrate();

        List<Class<?>> entities = orderedEntities(order);
        assertThat(entities).contains(Article.class, BenefitCard.class, Benefit.class,
            PlanSubject.class, StudyGroup.class);

        StandardServiceRegistry registry = new StandardServiceRegistryBuilder()
            .applySettings(Map.of(
                AvailableSettings.JAKARTA_JDBC_URL, POSTGRES.getJdbcUrl(),
                AvailableSettings.JAKARTA_JDBC_USER, POSTGRES.getUsername(),
                AvailableSettings.JAKARTA_JDBC_PASSWORD, POSTGRES.getPassword(),
                AvailableSettings.HBM2DDL_AUTO, "validate",
                AvailableSettings.PHYSICAL_NAMING_STRATEGY,
                    PhysicalNamingStrategyStandardImpl.class.getName(),
                AvailableSettings.JDBC_TIME_ZONE, "UTC"))
            .build();
        try {
            MetadataSources sources = new MetadataSources(registry);
            entities.forEach(sources::addAnnotatedClass);
            // Throws SchemaManagementException on any mapping/schema mismatch.
            try (SessionFactory sf = sources.buildMetadata().buildSessionFactory()) {
                assertThat(sf.isOpen()).isTrue();
            }
        } finally {
            StandardServiceRegistryBuilder.destroy(registry);
        }
    }

    private static List<Class<?>> orderedEntities(Order order) throws ClassNotFoundException {
        var scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(Entity.class));
        List<Class<?>> classes = new ArrayList<>();
        for (var bd : scanner.findCandidateComponents("org.ceitba.api.domain")) {
            classes.add(Class.forName(bd.getBeanClassName()));
        }
        Comparator<Class<?>> byName = Comparator.comparing(Class::getName);
        switch (order) {
            case ALPHABETICAL -> classes.sort(byName);
            case REVERSE_ALPHABETICAL -> classes.sort(byName.reversed());
            case ARTICLE_FIRST -> {
                classes.sort(byName);
                classes.remove(Article.class);
                classes.add(0, Article.class);
            }
            case ARTICLE_LAST -> {
                classes.sort(byName);
                classes.remove(Article.class);
                classes.add(Article.class);
            }
        }
        return classes;
    }
}
