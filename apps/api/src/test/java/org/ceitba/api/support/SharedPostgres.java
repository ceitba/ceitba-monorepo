package org.ceitba.api.support;

import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * One Postgres container per test JVM, with a fresh, empty database per
 * consumer.
 *
 * <p>Starting a container for every IT class cost about 1.5 s each (~100 s per
 * CI run). The server is shared, but each consumer gets its own database, so
 * schemas, data and Flyway history never leak between them. Nothing in the
 * schema is cluster-wide (no roles, tablespaces or extensions), and advisory
 * locks are scoped per database.
 *
 * <p>{@code @SpringBootTest} classes do not call this: every Spring test
 * context gets its own database automatically
 * ({@link ItDatabaseContextCustomizerFactory}). Plain JUnit ITs that drive
 * Flyway or Hibernate themselves use:
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
            // Throwaway data: keep it in RAM and skip every durability step.
            // Capped so a leak fails loudly instead of eating the runner's RAM;
            // each context's database is dropped when the context closes.
            .withTmpFs(Map.of("/var/lib/postgresql/data", "rw,size=2g"))
            .withCommand("postgres",
                // A few cached test contexts (10 pooled connections each) plus
                // the plain-JUnit ITs all point at this one server.
                "-c", "max_connections=200",
                "-c", "fsync=off",
                "-c", "synchronous_commit=off",
                "-c", "full_page_writes=off",
                // WAL lives on the tmpfs too; the 1 GB default is wasted RAM.
                "-c", "max_wal_size=128MB");

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
        return new Database(name, url, CONTAINER.getUsername(), CONTAINER.getPassword());
    }

    /** Drops a database made by {@link #newDatabase()}, closing any connection still open on it. */
    public static void dropDatabase(Database database) {
        try (var c = DriverManager.getConnection(
                 CONTAINER.getJdbcUrl(), CONTAINER.getUsername(), CONTAINER.getPassword());
             var s = c.createStatement()) {
            s.execute("DROP DATABASE IF EXISTS " + database.name() + " WITH (FORCE)");
        } catch (SQLException e) {
            throw new IllegalStateException("Could not drop test database " + database.name(), e);
        }
    }

    /** Connection details for one per-class database; mirrors the container getters. */
    public record Database(String name, String jdbcUrl, String username, String password) {
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
