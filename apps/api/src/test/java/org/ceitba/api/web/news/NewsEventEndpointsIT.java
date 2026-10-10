package org.ceitba.api.web.news;

import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

import com.jayway.jsonpath.JsonPath;

import static org.assertj.core.api.Assertions.assertThat;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class NewsEventEndpointsIT {

    @Autowired MockMvc mvc;
    @Autowired NewsEventRepository eventRepo;
    @Autowired OrganizationRepository orgRepo;

    @BeforeEach
    void seed() {
        eventRepo.deleteAll();
        orgRepo.deleteAll();

        orgRepo.save(new Organization("it", "IT", "IT Branch"));

        eventRepo.save(new NewsEvent("e1", "Hackathon",
            LocalDate.of(2026, 6, 15), LocalTime.of(9, 0), LocalTime.of(18, 0),
            "Aula Magna", "academic"));
        eventRepo.save(new NewsEvent("e2", "Talk",
            LocalDate.of(2026, 7, 1), LocalTime.of(18, 0), LocalTime.of(20, 0),
            "SUM", "tech"));
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar").claim("name", "Boss"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"),
                         new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    private static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "user@itba.edu.ar").claim("name", "User"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    // -- Public reads ----------------------------------------------------------

    @Test
    void listReturnsAllEvents() throws Exception {
        mvc.perform(get("/v1/news/events"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(2))
            .andExpect(jsonPath("$.meta.total").value(2));
    }

    // Events sharing a date (and start time) must not repeat or vanish across
    // offset pages: the ORDER BY breaks ties on start time, then id.
    @Test
    void paginationIsStrictWhenDatesTie() throws Exception {
        for (String id : List.of("x3", "x1", "x2")) {
            eventRepo.save(new NewsEvent(id, "Tied " + id,
                LocalDate.of(2026, 8, 1), LocalTime.of(10, 0), LocalTime.of(12, 0), "SUM", "tech"));
        }
        eventRepo.save(new NewsEvent("x0", "Earlier same day",
            LocalDate.of(2026, 8, 1), LocalTime.of(8, 0), LocalTime.of(9, 0), "SUM", "tech"));

        var seen = new ArrayList<String>();
        for (int page = 1; page <= 3; page++) {
            String body = mvc.perform(get("/v1/news/events?limit=2&page=" + page))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
            List<String> ids = JsonPath.read(body, "$.data[*].id");
            seen.addAll(ids);
        }
        assertThat(seen).containsExactly("e1", "e2", "x0", "x1", "x2", "x3");
    }

    @Test
    void listClampsLimit() throws Exception {
        mvc.perform(get("/v1/news/events?limit=0"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.meta.total").value(2))
            .andExpect(jsonPath("$.meta.limit").value(1));

        mvc.perform(get("/v1/news/events?limit=1000000"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(2))
            .andExpect(jsonPath("$.meta.limit").value(100));
    }

    @Test
    void listFiltersByCategory() throws Exception {
        mvc.perform(get("/v1/news/events?category=tech"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].id").value("e2"));
    }

    @Test
    void listFiltersByDateRange() throws Exception {
        mvc.perform(get("/v1/news/events?from=2026-07-01"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].id").value("e2"));
    }

    @Test
    void getByIdReturnsCorrectShape() throws Exception {
        mvc.perform(get("/v1/news/events/e1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("e1"))
            .andExpect(jsonPath("$.title").value("Hackathon"))
            .andExpect(jsonPath("$.location").value("Aula Magna"))
            .andExpect(jsonPath("$.category").value("academic"));
    }

    @Test
    void unknownIdReturns404() throws Exception {
        mvc.perform(get("/v1/news/events/nope"))
            .andExpect(status().isNotFound());
    }

    // -- Auth gates ------------------------------------------------------------

    @Test
    void anonymousCannotCreate() throws Exception {
        mvc.perform(post("/v1/news/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"T\",\"eventDate\":\"2026-08-01\",\"startTime\":\"10:00\",\"endTime\":\"12:00\",\"location\":\"L\",\"category\":\"General\"}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void regularUserCannotCreate() throws Exception {
        mvc.perform(post("/v1/news/events").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"T\",\"eventDate\":\"2026-08-01\",\"startTime\":\"10:00\",\"endTime\":\"12:00\",\"location\":\"L\",\"category\":\"General\"}"))
            .andExpect(status().isForbidden());
    }

    // -- Staff CRUD ------------------------------------------------------------

    @Test
    void staffCanCreateEvent() throws Exception {
        mvc.perform(post("/v1/news/events").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"New Event","eventDate":"2026-09-01",
                     "startTime":"09:00","endTime":"11:00",
                     "location":"Room 101","category":"Académico",
                     "description":"Details here"}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.title").value("New Event"))
            .andExpect(jsonPath("$.location").value("Room 101"))
            .andExpect(jsonPath("$.description").value("Details here"));
    }

    @Test
    void staffCanPatchEvent() throws Exception {
        mvc.perform(patch("/v1/news/events/e1").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Hackathon 2026\",\"description\":\"Updated\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Hackathon 2026"))
            .andExpect(jsonPath("$.description").value("Updated"))
            .andExpect(jsonPath("$.location").value("Aula Magna")); // unchanged
    }

    @Test
    void staffCanDelete() throws Exception {
        mvc.perform(delete("/v1/news/events/e2").with(staff()))
            .andExpect(status().isNoContent());
        mvc.perform(get("/v1/news/events/e2"))
            .andExpect(status().isNotFound());
    }

    @Test
    void createValidationFailsOnMissingTitle() throws Exception {
        mvc.perform(post("/v1/news/events").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"\",\"eventDate\":\"2026-08-01\",\"startTime\":\"10:00\",\"endTime\":\"12:00\",\"location\":\"L\",\"category\":\"General\"}"))
            .andExpect(status().isBadRequest());
    }
}
