package org.ceitba.api.support;

import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * One Postgres container per test JVM, with a fresh, empty database per IT
 * class.
 *
 * <p>Starting a container for every IT class cost about 1.5 s each (~100 s per
 * CI run). The server is shared, but each class still gets its own database, so
 * schemas, data and Flyway history never leak between classes. Nothing in the
 * schema is cluster-wide (no roles, tablespaces or extensions), and advisory
 * locks are scoped per database.
 *
 * <p>Usage, in place of a {@code @Container PostgreSQLContainer}:
 * <pre>{@code
 * static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();
 * }</pre>
 * The container is never stopped explicitly; Testcontainers' Ryuk removes it
 * when the JVM exits.
 */
public final class SharedPostgres {

    private static final AtomicInteger COUNTER = new AtomicInteger();

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> CONTAINER =
        new PostgreSQLContainer<>("postgres:16-alpine")
            // Spring keeps up to 32 test contexts (10 pooled connections each)
            // open, and they all point at this one server.
            .withCommand("postgres", "-c", "max_connections=500", "-c", "fsync=off");

    static {
        CONTAINER.start();
    }

    private SharedPostgres() {
    }

    /** Creates a new empty database on the shared server. */
    public static Database newDatabase() {
        var name = "it_" + COUNTER.incrementAndGet();
        try (var c = DriverManager.getConnection(
                 CONTAINER.getJdbcUrl(), CONTAINER.getUsername(), CONTAINER.getPassword());
             var s = c.createStatement()) {
            s.execute("CREATE DATABASE " + name);
        } catch (SQLException e) {
            throw new IllegalStateException("Could not create test database " + name, e);
        }
        var url = "jdbc:postgresql://" + CONTAINER.getHost() + ":"
            + CONTAINER.getMappedPort(PostgreSQLContainer.POSTGRESQL_PORT) + "/" + name;
        return new Database(url, CONTAINER.getUsername(), CONTAINER.getPassword());
    }

    /** Connection details for one per-class database; mirrors the container getters. */
    public record Database(String jdbcUrl, String username, String password) {
        public String getJdbcUrl() {
            return jdbcUrl;
        }

        public String getUsername() {
            return username;
        }

        public String getPassword() {
            return password;
        }
    }
}
