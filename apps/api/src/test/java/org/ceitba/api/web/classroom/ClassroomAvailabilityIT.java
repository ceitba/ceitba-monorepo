package org.ceitba.api.web.classroom;

import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.domain.SubjectType;
import org.ceitba.api.repository.CommissionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;

import static org.hamcrest.Matchers.contains;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@Import(ClassroomAvailabilityIT.FixedClock.class)
class ClassroomAvailabilityIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    // Monday 2026-09-21 10:30 ART.
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 21);

    @TestConfiguration
    static class FixedClock {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(Instant.parse("2026-09-21T13:30:00Z"),
                ZoneId.of("America/Argentina/Buenos_Aires"));
        }
    }

    @Autowired MockMvc mvc;
    @Autowired CommissionRepository commissionRepository;

    @BeforeEach
    void seed() {
        commissionRepository.deleteAll();

        var active = new Commission("C-A", "93.12", "A",
            TODAY.minusMonths(1), TODAY.plusMonths(1), 10, 30, SubjectType.SEMESTRAL);
        active.getTimes().add(new CommissionTime(
            "C-A", DayOfWeek.MONDAY, LocalTime.of(9, 0), "101", "SDF", LocalTime.of(11, 0)));
        active.getTimes().add(new CommissionTime(
            "C-A", DayOfWeek.MONDAY, LocalTime.of(14, 0), "101", "SDF", LocalTime.of(23, 0)));
        // Only busy on Wednesday: still a Monday candidate.
        active.getTimes().add(new CommissionTime(
            "C-A", DayOfWeek.WEDNESDAY, LocalTime.of(9, 0), "102", "SDF", LocalTime.of(11, 0)));
        active.getTimes().add(new CommissionTime(
            "C-A", DayOfWeek.THURSDAY, LocalTime.of(8, 0), "7", "SDT", LocalTime.of(10, 0)));
        commissionRepository.save(active);

        var online = new Commission("C-OL", "93.12", "OL",
            TODAY.minusMonths(1), TODAY.plusMonths(1), 5, 30, SubjectType.SEMESTRAL);
        online.getTimes().add(new CommissionTime(
            "C-OL", DayOfWeek.MONDAY, LocalTime.of(14, 0), "Virtual Asincrónico", "Online", LocalTime.of(17, 0)));
        commissionRepository.save(online);

        // Ended last month: neither part of the universe nor busy.
        var ended = new Commission("C-OLD", "93.13", "X",
            TODAY.minusMonths(5), TODAY.minusMonths(1), 5, 30, SubjectType.SEMESTRAL);
        ended.getTimes().add(new CommissionTime(
            "C-OLD", DayOfWeek.MONDAY, LocalTime.of(8, 0), "999", "SDR", LocalTime.of(23, 0)));
        commissionRepository.save(ended);
    }

    @Test
    void anonymousGetsFreeRoomsForNowInArt() throws Exception {
        mvc.perform(get("/v1/classrooms/availability"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.day").value("MONDAY"))
            .andExpect(jsonPath("$.at").value("10:30"))
            .andExpect(jsonPath("$.minMinutes").value(60))
            .andExpect(jsonPath("$.buildings[*].building", contains("SDF", "SDT")))
            // SDF: 101 busy 09-11 and 14-23 -> free 11:00-14:00 (upcoming).
            //      102 only busy Wednesday -> free all day (now).
            .andExpect(jsonPath("$.buildings[0].totalClassrooms").value(2))
            .andExpect(jsonPath("$.buildings[0].freeNowCount").value(1))
            .andExpect(jsonPath("$.buildings[0].classrooms[0].classroom").value("102"))
            .andExpect(jsonPath("$.buildings[0].classrooms[0].freeFrom").value("08:00"))
            .andExpect(jsonPath("$.buildings[0].classrooms[0].freeUntil").value("23:00"))
            .andExpect(jsonPath("$.buildings[0].classrooms[0].freeNow").value(true))
            .andExpect(jsonPath("$.buildings[0].classrooms[1].classroom").value("101"))
            .andExpect(jsonPath("$.buildings[0].classrooms[1].freeFrom").value("11:00"))
            .andExpect(jsonPath("$.buildings[0].classrooms[1].freeUntil").value("14:00"))
            .andExpect(jsonPath("$.buildings[0].classrooms[1].freeNow").value(false))
            .andExpect(jsonPath("$.buildings[1].freeNowCount").value(1));
    }

    @Test
    void explicitDayBuildingAndTime() throws Exception {
        mvc.perform(get("/v1/classrooms/availability")
                .param("day", "wednesday").param("building", "SDF").param("at", "10:00"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.day").value("WEDNESDAY"))
            .andExpect(jsonPath("$.buildings.length()").value(1))
            .andExpect(jsonPath("$.buildings[0].freeNowCount").value(1))
            .andExpect(jsonPath("$.buildings[0].classrooms[*].classroom", contains("101", "102")))
            .andExpect(jsonPath("$.buildings[0].classrooms[1].freeFrom").value("11:00"));
    }

    @Test
    void invalidDayReturns400() throws Exception {
        mvc.perform(get("/v1/classrooms/availability").param("day", "funday"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
    }

    @Test
    void nonNumericMinMinutesReturns400() throws Exception {
        mvc.perform(get("/v1/classrooms/availability").param("minMinutes", "lots"))
            .andExpect(status().isBadRequest());
    }
}
