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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.LocalDate;
import java.time.LocalTime;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class NewsEventEndpointsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

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
                .content("{\"title\":\"T\",\"eventDate\":\"2026-08-01\",\"startTime\":\"10:00\",\"endTime\":\"12:00\",\"location\":\"L\",\"category\":\"C\"}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void regularUserCannotCreate() throws Exception {
        mvc.perform(post("/v1/news/events").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"T\",\"eventDate\":\"2026-08-01\",\"startTime\":\"10:00\",\"endTime\":\"12:00\",\"location\":\"L\",\"category\":\"C\"}"))
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
                     "location":"Room 101","category":"workshop",
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
                .content("{\"title\":\"\",\"eventDate\":\"2026-08-01\",\"startTime\":\"10:00\",\"endTime\":\"12:00\",\"location\":\"L\",\"category\":\"C\"}"))
            .andExpect(status().isBadRequest());
    }
}
