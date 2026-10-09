package org.ceitba.api.web.news;

import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.ceitba.api.support.SharedPostgres;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Org stats (GET /v1/organizations/{slug}/analytics): only the org's own
// content counts, the window is respected, and it's for members only.
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class OrgAnalyticsIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired UserRepository userRepo;
    @Autowired OrganizationRepository orgRepo;
    @Autowired UserOrganizationRepository membershipRepo;
    @Autowired ArticleRepository articleRepo;
    @Autowired NewsEventRepository eventRepo;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM public.analytics_events");
        jdbc.update("DELETE FROM public.push_log");
        jdbc.update("DELETE FROM public.user_follows");
        articleRepo.deleteAll();
        eventRepo.deleteAll();
        membershipRepo.deleteAll();
        userRepo.deleteAll();
        orgRepo.deleteAll();

        orgRepo.save(new Organization("sabf", "SABF", "South American Business Forum"));
        orgRepo.save(new Organization("trama", "TRAMA", "TRAMA ITBA"));
        var alice = userRepo.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
        var bob = userRepo.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));
        membershipRepo.save(new UserOrganization(alice.getId(), "sabf", "member"));

        for (var org : List.of("sabf", "trama")) {
            var a = new Article(org + "-art", org + " news", "x", List.of("p"), "Campus", List.of(org));
            a.setOrganization(orgRepo.findById(org).orElseThrow());
            articleRepo.save(a);
        }
        var e = new NewsEvent("sabf-evt", "SABF meetup", LocalDate.now().plusDays(3),
            LocalTime.of(18, 0), LocalTime.of(20, 0), "Aula 1", "Campus");
        e.setOrganization(orgRepo.findById("sabf").orElseThrow());
        eventRepo.save(e);

        // 3 views of SABF's article (2 sessions), 1 of its event, 2 of TRAMA's
        // article, and an old SABF view outside a 30-day window.
        view("article_view", "s1", "sabf-art", null, "now()");
        view("article_view", "s1", "sabf-art", null, "now()");
        view("article_view", "s2", "sabf-art", null, "now()");
        view("event_view", "s3", null, "sabf-evt", "now()");
        view("article_view", "s4", "trama-art", null, "now()");
        view("article_view", "s4", "trama-art", null, "now()");
        view("article_view", "s5", "sabf-art", null, "now() - interval '60 days'");

        jdbc.update("INSERT INTO public.user_follows (user_id, org_slug, created_at) VALUES (?, 'sabf', now() - interval '90 days')", alice.getId());
        jdbc.update("INSERT INTO public.user_follows (user_id, org_slug, created_at) VALUES (?, 'sabf', now())", bob.getId());
        jdbc.update("INSERT INTO public.push_log (org_slug, kind, ref_id, targeted, sent) VALUES ('sabf', 'article', 'sabf-art', 5, 4)");
    }

    private void view(String type, String session, String articleId, String eventId, String ts) {
        jdbc.update("INSERT INTO public.analytics_events (type, session_id, ts, article_id, event_id) VALUES (?, ?, "
            + ts + ", ?, ?)", type, session, articleId, eventId);
    }

    private static RequestPostProcessor as(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", email))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Test
    void memberSeesOnlyTheOrgsOwnNumbers() throws Exception {
        mvc.perform(get("/v1/organizations/sabf/analytics").param("days", "30").with(as("alice@itba.edu.ar")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.articleViews").value(3))
            .andExpect(jsonPath("$.eventViews").value(1))
            .andExpect(jsonPath("$.uniqueVisitors").value(3))
            .andExpect(jsonPath("$.daily.length()").value(30))
            .andExpect(jsonPath("$.topArticles[0].articleId").value("sabf-art"))
            .andExpect(jsonPath("$.topArticles[0].views").value(3))
            .andExpect(jsonPath("$.events[0].eventId").value("sabf-evt"))
            .andExpect(jsonPath("$.events[0].views").value(1))
            .andExpect(jsonPath("$.followers.total").value(2))
            .andExpect(jsonPath("$.followers.newInPeriod").value(1))
            .andExpect(jsonPath("$.followers.cumulative[0].count").value(1))
            .andExpect(jsonPath("$.followers.cumulative[29].count").value(2))
            .andExpect(jsonPath("$.pushes.pushes").value(1))
            .andExpect(jsonPath("$.pushes.devicesReached").value(4));
    }

    @Test
    void outsidersAndBadWindowsAreRefused() throws Exception {
        mvc.perform(get("/v1/organizations/sabf/analytics").with(as("bob@itba.edu.ar")))
            .andExpect(status().isForbidden());
        mvc.perform(get("/v1/organizations/sabf/analytics").param("days", "0").with(as("alice@itba.edu.ar")))
            .andExpect(status().isBadRequest());
    }
}
