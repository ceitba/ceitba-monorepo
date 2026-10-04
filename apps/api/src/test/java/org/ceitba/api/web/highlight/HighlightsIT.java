package org.ceitba.api.web.highlight;

import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.domain.HomeHighlight;
import org.ceitba.api.repository.HomeHighlightRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
@Import(HighlightsIT.FixedClock.class)
class HighlightsIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    private static final Instant NOW = Instant.parse("2026-09-21T15:00:00Z");

    @TestConfiguration
    static class FixedClock {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(NOW, ZoneId.of("America/Argentina/Buenos_Aires"));
        }
    }

    @Autowired MockMvc mvc;
    @Autowired HomeHighlightRepository repository;

    @BeforeEach
    void clean() {
        repository.deleteAll();
    }

    private static OffsetDateTime at(long hoursFromNow) {
        return NOW.plusSeconds(hoursFromNow * 3600).atOffset(ZoneOffset.UTC);
    }

    private HomeHighlight save(String title, int position, OffsetDateTime starts,
                               OffsetDateTime ends, boolean active) {
        var h = new HomeHighlight(title, "https://img.example/" + title + ".png");
        h.setPosition(position);
        h.setStartsAt(starts);
        h.setEndsAt(ends);
        h.setActive(active);
        return repository.save(h);
    }

    private static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "regular@itba.edu.ar"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    private static final String BODY = """
        {"title":"Semana del estudiante","description":"Actividades","imageUrl":"https://img.example/a.png",
         "linkUrl":"https://ceitba.org.ar","position":2,
         "startsAt":"2026-09-20T00:00:00Z","endsAt":"2026-09-30T00:00:00Z"}""";

    @Test
    void publicListShowsOnlyActiveInsideWindowOrderedByPosition() throws Exception {
        save("third", 3, null, null, true);
        save("first", 1, at(-1), at(1), true);
        save("second", 2, null, at(24), true);
        save("inactive", 0, null, null, false);
        save("expired", 0, null, at(-1), true);
        save("endsNow", 0, null, at(0), true);
        save("scheduled", 0, at(1), null, true);
        save("startsNow", 4, at(0), null, true);

        mvc.perform(get("/v1/highlights"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[*].title", contains("first", "second", "third", "startsNow")))
            .andExpect(jsonPath("$[0].imageUrl").value("https://img.example/first.png"))
            .andExpect(jsonPath("$[0].active").value(true));
    }

    @Test
    void writesRequireStaff() throws Exception {
        var id = save("x", 0, null, null, true).getId();

        mvc.perform(post("/v1/highlights").contentType(MediaType.APPLICATION_JSON).content(BODY))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/highlights").with(user()).contentType(MediaType.APPLICATION_JSON).content(BODY))
            .andExpect(status().isForbidden());
        mvc.perform(put("/v1/highlights/" + id).with(user()).contentType(MediaType.APPLICATION_JSON).content(BODY))
            .andExpect(status().isForbidden());
        mvc.perform(delete("/v1/highlights/" + id).with(user()))
            .andExpect(status().isForbidden());
        mvc.perform(get("/v1/highlights/all"))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/highlights/all").with(user()))
            .andExpect(status().isForbidden());

        assertThat(repository.findById(id)).get().extracting(HomeHighlight::getTitle).isEqualTo("x");
    }

    @Test
    void staffCrudRoundTrip() throws Exception {
        var created = mvc.perform(post("/v1/highlights").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(BODY))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.title").value("Semana del estudiante"))
            .andExpect(jsonPath("$.position").value(2))
            .andExpect(jsonPath("$.active").value(true))
            .andReturn().getResponse().getContentAsString();
        var id = com.jayway.jsonpath.JsonPath.read(created, "$.id").toString();

        mvc.perform(get("/v1/highlights"))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].linkUrl").value("https://ceitba.org.ar"));

        var deactivate = BODY.replace("\"position\":2", "\"position\":5,\"active\":false");
        mvc.perform(put("/v1/highlights/" + id).with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(deactivate))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.position").value(5))
            .andExpect(jsonPath("$.active").value(false));

        mvc.perform(get("/v1/highlights")).andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/v1/highlights/all").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1));

        mvc.perform(delete("/v1/highlights/" + id).with(staff())).andExpect(status().isNoContent());
        mvc.perform(delete("/v1/highlights/" + id).with(staff())).andExpect(status().isNotFound());
        mvc.perform(put("/v1/highlights/" + UUID.randomUUID()).with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(BODY))
            .andExpect(status().isNotFound());
    }

    @Test
    void invalidBodiesReturn400() throws Exception {
        var inverted = BODY.replace("2026-09-30T00:00:00Z", "2026-09-10T00:00:00Z");
        mvc.perform(post("/v1/highlights").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(inverted))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));

        var noImage = BODY.replace("\"imageUrl\":\"https://img.example/a.png\"", "\"imageUrl\":\" \"");
        mvc.perform(post("/v1/highlights").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(noImage))
            .andExpect(status().isBadRequest());

        for (var bad : new String[] {"javascript:alert(1)", "intent://x#Intent;end", "ceitba.org.ar",
                "https://ceitba.org.ar/" + "a".repeat(2048)}) {
            mvc.perform(post("/v1/highlights").with(staff()).contentType(MediaType.APPLICATION_JSON)
                    .content(BODY.replace("\"linkUrl\":\"https://ceitba.org.ar\"", "\"linkUrl\":\"" + bad + "\"")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("ValidationError"));
        }
        var ftpImage = BODY.replace("https://img.example/a.png", "ftp://img.example/a.png");
        mvc.perform(post("/v1/highlights").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(ftpImage))
            .andExpect(status().isBadRequest());

        assertThat(repository.count()).isZero();
    }

    @Test
    void emptyLinkUrlIsStoredAsNoLink() throws Exception {
        var noLink = BODY.replace("\"linkUrl\":\"https://ceitba.org.ar\"", "\"linkUrl\":\"\"");
        mvc.perform(post("/v1/highlights").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(noLink))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.linkUrl").doesNotExist());
    }
}
