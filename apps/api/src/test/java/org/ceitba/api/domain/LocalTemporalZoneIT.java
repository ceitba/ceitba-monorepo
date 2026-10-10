package org.ceitba.api.domain;

import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.external.itba.FakeItbaApiClient;
import org.ceitba.api.external.itba.SubjectPlanProjection;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.CommissionTimeRepository;
import org.ceitba.api.repository.HomeHighlightRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.FileSystemResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.TimeZone;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * TIME / DATE columns must be read and written as plain wall-clock values,
 * whatever the JVM default time zone is.
 *
 * <p>Production runs with TZ=America/Argentina/Buenos_Aires (UTC-3). While
 * {@code hibernate.jdbc.time_zone: UTC} was set, Hibernate 6.5 bound and read
 * LocalTime through java.sql.Time with a UTC Calendar (TimeJdbcType), which
 * converts from the JVM zone: a literal 08:00 in commission_time was served as
 * 05:00, and the sync stored 08:00 as 11:00. CI runs in UTC, where that
 * conversion is a no-op, and the other ITs round-trip through JPA (both
 * shifts cancel), so nothing caught it. DATE columns were not affected
 * (DateJdbcType ignores the JDBC time zone); they are asserted here anyway
 * so a future Hibernate/config change can't start shifting them.
 *
 * <p>The default zone is switched before the Spring context of this class
 * starts (@BeforeAll runs before the test instance is injected) and restored
 * afterwards, so it does not leak into other ITs in the same JVM.
 *
 * <p>The context must also be this class's own: the shared IT context was
 * started under the CI zone, and one started here must not be reused by
 * others. The marker property gives it a cache key nobody else has, and
 * {@code @DirtiesContext} closes it when the class is done.
 */
@SpringBootTest(properties = "it.context=local-temporal-zone")
@AutoConfigureMockMvc
@DirtiesContext
class LocalTemporalZoneIT {

    private static TimeZone originalZone;

    @BeforeAll
    static void useArgentinaZone() {
        originalZone = TimeZone.getDefault();
        TimeZone.setDefault(TimeZone.getTimeZone("America/Argentina/Buenos_Aires"));
    }

    @AfterAll
    static void restoreZone() {
        TimeZone.setDefault(originalZone);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired FakeItbaApiClient fakeClient;
    @Autowired CommissionRepository commissionRepository;
    @Autowired CommissionTimeRepository commissionTimeRepository;
    @Autowired NewsEventRepository newsEventRepository;
    @Autowired HomeHighlightRepository homeHighlightRepository;

    @BeforeEach
    void clean() {
        assertThat(TimeZone.getDefault().getID()).isEqualTo("America/Argentina/Buenos_Aires");
        fakeClient.reset();
        jdbc.update("DELETE FROM public.commission_time");
        jdbc.update("DELETE FROM public.commission");
        jdbc.update("DELETE FROM public.plan_subject");
        jdbc.update("DELETE FROM public.subject");
        jdbc.update("DELETE FROM public.news_events");
        jdbc.update("DELETE FROM public.home_highlights");
    }

    // (a) literal DB values (as written by the old backend / SQL imports) are
    // read through JPA unchanged.
    @Test
    void sqlWrittenCommissionTimeAndDatesReadBackAsWallClock() {
        insertCommissionWithSql();

        var commission = commissionRepository.findById("C-1").orElseThrow();
        assertThat(commission.getCourseStart()).isEqualTo(LocalDate.of(2026, 3, 9));
        assertThat(commission.getCourseEnd()).isEqualTo(LocalDate.of(2099, 7, 4));

        var times = commissionTimeRepository.findAllOrdered();
        assertThat(times).hasSize(1);
        assertThat(times.get(0).getHourFrom()).isEqualTo(LocalTime.of(8, 0));
        assertThat(times.get(0).getHourTo()).isEqualTo(LocalTime.of(11, 0));
    }

    // (b) values saved through JPA are stored literally.
    @Test
    void jpaWrittenCommissionTimeAndDatesAreStoredAsWallClock() {
        jdbc.update("INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('93.12', 'Análisis', 6, now())");
        var c = new Commission("C-2", "93.12", "A",
            LocalDate.of(2026, 3, 9), LocalDate.of(2099, 7, 4), 10, 30, SubjectType.SEMESTRAL);
        c.getTimes().add(new CommissionTime("C-2", DayOfWeek.MONDAY,
            LocalTime.of(8, 0), "101F", "SDF", LocalTime.of(11, 0)));
        commissionRepository.save(c);

        assertThat(jdbc.queryForObject(
            "SELECT course_start::text || '/' || course_end::text FROM public.commission WHERE id = 'C-2'",
            String.class)).isEqualTo("2026-03-09/2099-07-04");
        assertThat(jdbc.queryForObject(
            "SELECT hour_from::text || '-' || hour_to::text FROM public.commission_time WHERE course_id = 'C-2'",
            String.class)).isEqualTo("08:00:00-11:00:00");

        // The composite id (course_id, day, hour_from) must resolve too.
        assertThat(commissionTimeRepository.findById(
            new CommissionTimeId("C-2", DayOfWeek.MONDAY, LocalTime.of(8, 0)))).isPresent();
    }

    // The public endpoints serialize the literal DB values.
    @Test
    void endpointsServeSqlWrittenTimesUnshifted() throws Exception {
        insertCommissionWithSql();
        jdbc.update("""
            INSERT INTO public.plan_subject (subject_id, plan_id, section, year, semester, credits_required)
            VALUES ('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, 0)
            """);
        fakeClient.stubPlan("S10-Rev23", List.of(
            new SubjectPlanProjection("93.12", "S10-Rev23", "Ciclo Básico", 1, 1,
                List.of(), null, "Análisis", 6)));

        mvc.perform(get("/v1/commissions").param("plan", "S10-Rev23"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].courseStart").value("2026-03-09"))
            .andExpect(jsonPath("$[0].times[0].hourFrom").value("08:00"))
            .andExpect(jsonPath("$[0].times[0].hourTo").value("11:00"));

        mvc.perform(get("/v1/subjects").param("plan", "S10-Rev23"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].commissions[0].schedule[0].time_from")
                .value("08:00:00"))
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].commissions[0].schedule[0].time_to")
                .value("11:00:00"));
    }

    @Test
    void newsEventTimeAndDateRoundTripAsWallClock() {
        jdbc.update("""
            INSERT INTO public.news_events (id, title, event_date, start_time, end_time, location, category, created_at)
            VALUES ('sql', 'SQL', '2026-03-09', '19:30:00', '21:00:00', 'SDF', 'talk', '2026-03-09 22:30:00+00')
            """);
        var fromSql = newsEventRepository.findById("sql").orElseThrow();
        assertThat(fromSql.getEventDate()).isEqualTo(LocalDate.of(2026, 3, 9));
        // timestamptz keeps its instant.
        assertThat(fromSql.getCreatedAt().toInstant()).isEqualTo(Instant.parse("2026-03-09T22:30:00Z"));
        assertThat(fromSql.getStartTime()).isEqualTo(LocalTime.of(19, 30));
        assertThat(fromSql.getEndTime()).isEqualTo(LocalTime.of(21, 0));

        newsEventRepository.save(new NewsEvent("jpa", "JPA", LocalDate.of(2026, 3, 9),
            LocalTime.of(19, 30), LocalTime.of(21, 0), "SDF", "talk"));
        assertThat(jdbc.queryForObject(
            "SELECT event_date::text FROM public.news_events WHERE id = 'jpa'", String.class))
            .isEqualTo("2026-03-09");
        assertThat(jdbc.queryForObject(
            "SELECT event_date::text || ' ' || start_time::text || '-' || end_time::text FROM public.news_events WHERE id = 'jpa'",
            String.class)).isEqualTo("2026-03-09 19:30:00-21:00:00");
    }

    @Test
    void timestamptzRoundTripsByInstant() {
        var startsAt = OffsetDateTime.of(2026, 3, 9, 8, 0, 0, 0, ZoneOffset.ofHours(-3));
        var h = new HomeHighlight("h", "https://example.com/i.png");
        h.setStartsAt(startsAt);
        h.setEndsAt(startsAt.plusDays(1));
        var id = homeHighlightRepository.save(h).getId();

        // Stored as the same instant (11:00Z)...
        assertThat(jdbc.queryForObject(
            "SELECT starts_at = TIMESTAMPTZ '2026-03-09 11:00:00+00' FROM public.home_highlights WHERE id = ?",
            Boolean.class, id)).isTrue();
        // ...and read back as the same instant.
        var read = homeHighlightRepository.findById(id).orElseThrow();
        assertThat(read.getStartsAt().toInstant()).isEqualTo(startsAt.toInstant());
        assertThat(read.getEndsAt().toInstant()).isEqualTo(startsAt.plusDays(1).toInstant());
    }

    // src/test/resources/application.yml shadows the main one in ITs, so the
    // tests above can't see the production config. Guard it directly.
    @Test
    void noConfigReintroducesJdbcTimeZone() {
        for (var name : List.of("application.yml", "application-dev.yml", "application-prod.yml")) {
            var file = Path.of("src/main/resources", name);
            assertThat(Files.exists(file)).as(file.toString()).isTrue();
            var yaml = new YamlPropertiesFactoryBean();
            yaml.setResources(new FileSystemResource(file));
            assertThat(yaml.getObject().stringPropertyNames())
                .as(name)
                .noneMatch(k -> k.endsWith("hibernate.jdbc.time_zone"));
        }
    }

    private void insertCommissionWithSql() {
        jdbc.update("INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('93.12', 'Análisis', 6, now())");
        jdbc.update("""
            INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end,
                                           enrolled_students, quota, subject_type)
            VALUES ('C-1', '93.12', 'A', '2026-03-09', '2099-07-04', 10, 30, 'SEMESTRAL')
            """);
        jdbc.update("""
            INSERT INTO public.commission_time (course_id, day, classroom, building, hour_from, hour_to)
            VALUES ('C-1', 'MONDAY', '101F', 'SDF', '08:00:00', '11:00:00')
            """);
    }
}
