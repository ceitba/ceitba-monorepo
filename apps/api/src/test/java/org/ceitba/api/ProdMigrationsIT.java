package org.ceitba.api;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.DriverManager;

import static org.assertj.core.api.Assertions.assertThat;

// Every other IT stops Flyway at the V4.x test mirrors (see
// src/test/resources/db/test-migration/README.md), so the production chain
// V5+ is never applied in tests. This one runs the real db/migration chain
// end to end on an empty database, the way a fresh prod install would.
@Testcontainers
class ProdMigrationsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Test
    void productionMigrationsApplyCleanly() throws Exception {
        var result = Flyway.configure()
            .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
            .locations("classpath:db/migration")
            .load()
            .migrate();
        assertThat(result.success).isTrue();

        try (var conn = DriverManager.getConnection(
                 POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var st = conn.prepareStatement("""
                 SELECT count(*) FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'sga_synced_at'
                 """);
             var rs = st.executeQuery()) {
            rs.next();
            assertThat(rs.getInt(1)).isZero();
        }
    }
}
