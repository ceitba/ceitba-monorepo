package org.ceitba.api;

import org.ceitba.api.support.SharedPostgres;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

// V29 folds legacy category spellings onto the canonical list. Runs the real
// prod chain up to V28, seeds legacy rows, applies V29 and checks the result.
class NewsCategoryMigrationIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @Test
    void v29MapsCaseAndAccentVariantsAndLeavesUnknownValues() throws Exception {
        flyway("28").migrate();

        try (Connection conn = connect(); var st = conn.createStatement()) {
            st.execute("""
                INSERT INTO public.articles (id, title, excerpt, category) VALUES
                  ('a-acad-upper',  't', 'e', 'ACADÉMICO'),
                  ('a-acad-plain',  't', 'e', 'academico'),
                  ('a-acad-ok',     't', 'e', 'Académico'),
                  ('a-dep',         't', 'e', 'DEPORTES'),
                  ('a-cult-space',  't', 'e', ' cultura '),
                  ('a-org',         't', 'e', 'ORGANIZACIONES'),
                  ('a-tec',         't', 'e', 'TECNOLOGIA'),
                  ('a-tec-acc',     't', 'e', 'tecnología'),
                  ('a-campus',      't', 'e', 'CAMPUS'),
                  ('a-general',     't', 'e', 'general'),
                  ('a-todos',       't', 'e', 'TODOS'),
                  ('a-tech',        't', 'e', 'tech')
                """);
            st.execute("""
                INSERT INTO public.news_events (id, title, event_date, start_time, end_time, location, category) VALUES
                  ('e-dep',  't', '2026-01-01', '10:00', '11:00', 'L', 'DEPORTES'),
                  ('e-acad', 't', '2026-01-01', '10:00', '11:00', 'L', 'ACADÉMICO'),
                  ('e-x',    't', '2026-01-01', '10:00', '11:00', 'L', 'workshop')
                """);
            st.execute("""
                INSERT INTO public.analytics_events (type, session_id, category) VALUES
                  ('category_view', 's', 'CULTURA'),
                  ('page_view',     's', NULL)
                """);
        }

        assertThat(flyway("29").migrate().success).isTrue();

        assertThat(categories("articles")).containsExactlyInAnyOrderEntriesOf(Map.ofEntries(
            Map.entry("a-acad-upper", "Académico"),
            Map.entry("a-acad-plain", "Académico"),
            Map.entry("a-acad-ok",    "Académico"),
            Map.entry("a-dep",        "Deportes"),
            Map.entry("a-cult-space", "Cultura"),
            Map.entry("a-org",        "Organizaciones"),
            Map.entry("a-tec",        "Tecnología"),
            Map.entry("a-tec-acc",    "Tecnología"),
            Map.entry("a-campus",     "Campus"),
            Map.entry("a-general",    "General"),
            Map.entry("a-todos",      "TODOS"),   // unknown: untouched
            Map.entry("a-tech",       "tech")));  // unknown: untouched
        assertThat(categories("news_events")).containsExactlyInAnyOrderEntriesOf(Map.of(
            "e-dep", "Deportes", "e-acad", "Académico", "e-x", "workshop"));

        try (Connection conn = connect(); var st = conn.createStatement();
             var rs = st.executeQuery("SELECT type, category FROM public.analytics_events ORDER BY id")) {
            rs.next();
            assertThat(rs.getString(2)).isEqualTo("Cultura");
            rs.next();
            assertThat(rs.getString(2)).isNull();
        }
    }

    private static Flyway flyway(String target) {
        return Flyway.configure()
            .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
            .schemas("public", "wiki")
            .defaultSchema("public")
            .locations("classpath:db/migration")
            .outOfOrder(true)
            .target(target)
            .load();
    }

    private static Connection connect() throws Exception {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private static Map<String, String> categories(String table) throws Exception {
        var out = new HashMap<String, String>();
        try (Connection conn = connect(); var st = conn.createStatement();
             var rs = st.executeQuery("SELECT id, category FROM public." + table)) {
            while (rs.next()) out.put(rs.getString(1), rs.getString(2));
        }
        return out;
    }
}
