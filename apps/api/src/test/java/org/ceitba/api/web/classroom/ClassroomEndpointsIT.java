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
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.LocalDate;
import java.time.LocalTime;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class ClassroomEndpointsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired CommissionRepository commissionRepository;

    @BeforeEach
    void seed() {
        commissionRepository.deleteAll();

        // Active commission today
        var today = LocalDate.now();
        var active = new Commission("C-A", "93.12", "A",
            today.minusMonths(1), today.plusMonths(1), 10, 30, SubjectType.SEMESTRAL);
        active.getTimes().add(new CommissionTime(
            "C-A", DayOfWeek.MONDAY, LocalTime.of(14, 0), "102T", "SDT", LocalTime.of(17, 0)));
        active.getTimes().add(new CommissionTime(
            "C-A", DayOfWeek.WEDNESDAY, LocalTime.of(9, 0), "102T", "SDT", LocalTime.of(11, 0)));
        commissionRepository.save(active);

        // Online commission — should be filtered out
        var online = new Commission("C-OL", "93.12", "OL",
            today.minusMonths(1), today.plusMonths(1), 5, 30, SubjectType.SEMESTRAL);
        online.getTimes().add(new CommissionTime(
            "C-OL", DayOfWeek.TUESDAY, LocalTime.of(14, 0), "Virtual Asincrónico", "Online", LocalTime.of(17, 0)));
        commissionRepository.save(online);
    }

    @Test
    void noFiltersGroupsByBuildingAndSkipsOnline() throws Exception {
        mvc.perform(get("/v1/classrooms"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.SDT").isArray())
            .andExpect(jsonPath("$.Online").doesNotExist());
    }

    @Test
    void statusOccupiedGroupsByDayAndBuilding() throws Exception {
        mvc.perform(get("/v1/classrooms?status=occupied"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.MONDAY.SDT[0].classroom").value("102T"))
            .andExpect(jsonPath("$.WEDNESDAY.SDT[0].classroom").value("102T"))
            // Online entries excluded
            .andExpect(jsonPath("$.TUESDAY").doesNotExist());
    }

    @Test
    void byBuildingReturnsClassroomList() throws Exception {
        mvc.perform(get("/v1/classrooms/building/SDT"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void byDayReturnsActiveSchedulesOnly() throws Exception {
        mvc.perform(get("/v1/classrooms/day/MONDAY"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].day").value("MONDAY"))
            .andExpect(jsonPath("$[0].classroom").value("102T"));
    }

    @Test
    void invalidDayReturns400() throws Exception {
        mvc.perform(get("/v1/classrooms/day/funday"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
    }

    @Test
    void overlappingConflictDetected() throws Exception {
        var body = """
            {"classroom":"102T","building":"SDT","day":"MONDAY","hourFrom":"15:00","hourTo":"16:00"}""";
        mvc.perform(post("/v1/classrooms/conflicts").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void touchingBoundariesDoNotConflict() throws Exception {
        // Existing 14:00-17:00. Request 17:00-18:00 — should NOT conflict.
        var body = """
            {"classroom":"102T","building":"SDT","day":"MONDAY","hourFrom":"17:00","hourTo":"18:00"}""";
        mvc.perform(post("/v1/classrooms/conflicts").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void invalidTimeOrderingReturns400() throws Exception {
        var body = """
            {"classroom":"102T","building":"SDT","day":"MONDAY","hourFrom":"18:00","hourTo":"17:00"}""";
        mvc.perform(post("/v1/classrooms/conflicts").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
    }
}
