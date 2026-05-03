package org.ceitba.api.web.analytics;

import org.ceitba.api.domain.news.Article;
import org.ceitba.api.repository.news.AnalyticsEventRepository;
import org.ceitba.api.repository.news.ArticleRepository;
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

import java.util.List;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class AnalyticsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired AnalyticsEventRepository analyticsRepo;
    @Autowired ArticleRepository articleRepo;

    @BeforeEach
    void seed() {
        analyticsRepo.deleteAll();
        articleRepo.deleteAll();
        articleRepo.save(new Article("a1", "Article", "e", List.of(), "tech", "A"));
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar").claim("name", "Boss"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"),
                         new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    // -- Ingest ----------------------------------------------------------------

    @Test
    void ingestBatchReturns202() throws Exception {
        mvc.perform(post("/v1/analytics/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"events":[
                      {"type":"article_view","sessionId":"s1","timestamp":1746316800000,"articleId":"a1"},
                      {"type":"page_view","sessionId":"s1","timestamp":1746316860000,"path":"/"}
                    ]}
                    """))
            .andExpect(status().isAccepted());
    }

    @Test
    void ingestPersistsEvents() throws Exception {
        mvc.perform(post("/v1/analytics/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"events\":[{\"type\":\"page_view\",\"sessionId\":\"s2\"}]}"))
            .andExpect(status().isAccepted());

        // Verify via summary (the count should reflect the ingested event)
        mvc.perform(get("/v1/analytics/summary?days=1").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.uniqueVisitors").value(1));
    }

    @Test
    void ingestWithInvalidTypeStillReturns202AndSkipsInvalid() throws Exception {
        // Invalid types are silently skipped; batch is accepted regardless
        mvc.perform(post("/v1/analytics/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"events\":[{\"type\":\"unknown_event\",\"sessionId\":\"s3\",\"timestamp\":1746316800000}]}"))
            .andExpect(status().isAccepted());
    }

    @Test
    void ingestEmptyEventArrayReturns400() throws Exception {
        mvc.perform(post("/v1/analytics/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"events\":[]}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void ingestBatchExceeding50EventsIsRejected() throws Exception {
        var events = "[" + String.join(",",
            java.util.Collections.nCopies(51,
                "{\"type\":\"page_view\",\"sessionId\":\"s\",\"timestamp\":1746316800000}")
        ) + "]";
        mvc.perform(post("/v1/analytics/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"events\":" + events + "}"))
            .andExpect(status().isBadRequest());
    }

    // -- Summary ---------------------------------------------------------------

    @Test
    void summaryRequiresAuth() throws Exception {
        mvc.perform(get("/v1/analytics/summary"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void summaryForbiddenForRegularUser() throws Exception {
        var regularUser = jwt().jwt(t -> t.claim("email", "u@itba.edu.ar"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
        mvc.perform(get("/v1/analytics/summary").with(regularUser))
            .andExpect(status().isForbidden());
    }

    @Test
    void staffCanAccessSummary() throws Exception {
        mvc.perform(get("/v1/analytics/summary").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalArticleViews").isNumber())
            .andExpect(jsonPath("$.uniqueVisitors").isNumber())
            .andExpect(jsonPath("$.topArticles").isArray())
            .andExpect(jsonPath("$.categoryViews").isArray())
            .andExpect(jsonPath("$.dailyViews").isArray())
            .andExpect(jsonPath("$.voteBreakdown").isArray());
    }

    @Test
    void summaryCountsArticleViews() throws Exception {
        mvc.perform(post("/v1/analytics/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"events\":[" +
                    "{\"type\":\"article_view\",\"sessionId\":\"s4\",\"articleId\":\"a1\"}," +
                    "{\"type\":\"article_view\",\"sessionId\":\"s5\",\"articleId\":\"a1\"}" +
                    "]}"))
            .andExpect(status().isAccepted());

        mvc.perform(get("/v1/analytics/summary?days=1").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalArticleViews").value(2))
            .andExpect(jsonPath("$.uniqueVisitors").value(2));
    }
}
