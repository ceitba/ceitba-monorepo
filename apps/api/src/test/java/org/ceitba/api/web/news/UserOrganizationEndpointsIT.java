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
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class UserOrganizationEndpointsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

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

    @BeforeEach
    void seed() {
        articleRepo.deleteAll();
        eventRepo.deleteAll();
        membershipRepo.deleteAll();
        userRepo.deleteAll();
        orgRepo.deleteAll();

        orgRepo.save(new Organization("sabf", "SABF", "South American Business Forum"));
        orgRepo.save(new Organization("trama", "TRAMA", "TRAMA ITBA"));

        var alice = userRepo.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
        membershipRepo.save(new UserOrganization(alice.getId(), "sabf", "member"));

        userRepo.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));

        var carol = userRepo.save(new User(UUID.randomUUID(), "carol@itba.edu.ar", "Carol"));
        membershipRepo.save(new UserOrganization(carol.getId(), "sabf", "admin"));

        var tramaArticle = new Article("trama-art", "TRAMA news", "x", List.of("p"), "news", List.of("TRAMA"));
        tramaArticle.setOrganization(orgRepo.findById("trama").orElseThrow());
        articleRepo.save(tramaArticle);
        var sabfArticle = new Article("sabf-art", "SABF news", "x", List.of("p"), "news", List.of("SABF"));
        sabfArticle.setOrganization(orgRepo.findById("sabf").orElseThrow());
        articleRepo.save(sabfArticle);

        var tramaEvent = new NewsEvent("trama-evt", "TRAMA meetup", LocalDate.of(2026, 6, 1),
            LocalTime.of(18, 0), LocalTime.of(20, 0), "Aula 1", "meetup");
        tramaEvent.setOrganization(orgRepo.findById("trama").orElseThrow());
        eventRepo.save(tramaEvent);
        var sabfEvent = new NewsEvent("sabf-evt", "SABF meetup", LocalDate.of(2026, 6, 1),
            LocalTime.of(18, 0), LocalTime.of(20, 0), "Aula 2", "meetup");
        sabfEvent.setOrganization(orgRepo.findById("sabf").orElseThrow());
        eventRepo.save(sabfEvent);
    }

    private static RequestPostProcessor orgAdmin() {
        return jwt().jwt(t -> t.claim("email", "carol@itba.edu.ar").claim("name", "Carol"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar").claim("name", "Boss"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    private static RequestPostProcessor member() {
        return jwt().jwt(t -> t.claim("email", "alice@itba.edu.ar").claim("name", "Alice"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static RequestPostProcessor outsider() {
        return jwt().jwt(t -> t.claim("email", "bob@itba.edu.ar").claim("name", "Bob"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Test
    void anonymousCannotListMyOrganizations() throws Exception {
        mvc.perform(get("/v1/me/organizations"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void memberSeesOwnMemberships() throws Exception {
        mvc.perform(get("/v1/me/organizations").with(member()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].slug").value("sabf"))
            .andExpect(jsonPath("$[0].role").value("member"));
    }

    @Test
    void outsiderSeesEmptyMemberships() throws Exception {
        mvc.perform(get("/v1/me/organizations").with(outsider()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void memberCanPatchOwnOrg() throws Exception {
        mvc.perform(patch("/v1/organizations/sabf").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"description\":\"by member\",\"logoUrl\":\"https://x/l.png\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.description").value("by member"))
            .andExpect(jsonPath("$.logoUrl").value("https://x/l.png"));
    }

    @Test
    void memberCannotPatchAnotherOrg() throws Exception {
        mvc.perform(patch("/v1/organizations/trama").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"description\":\"nope\"}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void memberCanPostArticleForOwnOrg() throws Exception {
        mvc.perform(post("/v1/articles").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "id": "art-1",
                      "title": "Hello",
                      "excerpt": "x",
                      "body": ["p1"],
                      "category": "news",
                      "authors": ["Alice"],
                      "organization": "sabf"
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value("art-1"));
    }

    @Test
    void memberCannotPostArticleForAnotherOrg() throws Exception {
        mvc.perform(post("/v1/articles").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "id": "art-2",
                      "title": "Hello",
                      "excerpt": "x",
                      "body": ["p1"],
                      "category": "news",
                      "authors": ["Alice"],
                      "organization": "trama"
                    }
                    """))
            .andExpect(status().isForbidden());
    }

    @Test
    void memberCanPostEventForOwnOrg() throws Exception {
        mvc.perform(post("/v1/news/events").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "id": "evt-1",
                      "title": "Workshop",
                      "eventDate": "2026-06-01",
                      "startTime": "18:00:00",
                      "endTime": "20:00:00",
                      "location": "Aula 101",
                      "category": "workshop",
                      "organization": "sabf"
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value("evt-1"));
    }

    @Test
    void memberCannotPostEventForAnotherOrg() throws Exception {
        mvc.perform(post("/v1/news/events").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "id": "evt-2",
                      "title": "Workshop",
                      "eventDate": "2026-06-01",
                      "startTime": "18:00:00",
                      "endTime": "20:00:00",
                      "location": "Aula 101",
                      "category": "workshop",
                      "organization": "trama"
                    }
                    """))
            .andExpect(status().isForbidden());
    }

    // POST with an id that already exists must not merge over the existing
    // row (here another org's article) — it's a conflict.
    @Test
    void postingArticleWithExistingIdReturns409AndLeavesItUntouched() throws Exception {
        mvc.perform(post("/v1/articles").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"id":"trama-art","title":"Hijacked","excerpt":"x","body":["p"],
                     "category":"news","authors":["Alice"],"organization":"sabf"}
                    """))
            .andExpect(status().isConflict());

        var article = articleRepo.findById("trama-art").orElseThrow();
        assertThat(article.getTitle()).isEqualTo("TRAMA news");
        assertThat(article.getOrganization().getSlug()).isEqualTo("trama");
    }

    @Test
    void postingEventWithExistingIdReturns409AndLeavesItUntouched() throws Exception {
        mvc.perform(post("/v1/news/events").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"id":"trama-evt","title":"Hijacked","eventDate":"2026-06-01",
                     "startTime":"18:00:00","endTime":"20:00:00","location":"x",
                     "category":"workshop","organization":"sabf"}
                    """))
            .andExpect(status().isConflict());

        var event = eventRepo.findById("trama-evt").orElseThrow();
        assertThat(event.getTitle()).isEqualTo("TRAMA meetup");
        assertThat(event.getOrganization().getSlug()).isEqualTo("trama");
    }

    @Test
    void memberCanPatchOwnOrgArticle() throws Exception {
        mvc.perform(patch("/v1/articles/sabf-art").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Edited\",\"organization\":\"sabf\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Edited"));
    }

    // Naming your own org in the body must not unlock another org's article.
    @Test
    void memberCannotTakeOverAnotherOrgsArticleByPatchingItsOrg() throws Exception {
        mvc.perform(patch("/v1/articles/trama-art").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Hijacked\",\"organization\":\"sabf\"}"))
            .andExpect(status().isForbidden());

        assertThat(articleRepo.findById("trama-art").orElseThrow().getTitle()).isEqualTo("TRAMA news");
    }

    @Test
    void memberCannotMoveOwnArticleToAnotherOrg() throws Exception {
        mvc.perform(patch("/v1/articles/sabf-art").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"organization\":\"trama\"}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void memberCannotTakeOverAnotherOrgsEventByPatchingItsOrg() throws Exception {
        mvc.perform(patch("/v1/news/events/trama-evt").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Hijacked\",\"organization\":\"sabf\"}"))
            .andExpect(status().isForbidden());

        assertThat(eventRepo.findById("trama-evt").orElseThrow().getTitle()).isEqualTo("TRAMA meetup");
    }

    @Test
    void memberCannotMoveOwnEventToAnotherOrg() throws Exception {
        mvc.perform(patch("/v1/news/events/sabf-evt").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"organization\":\"trama\"}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void memberCanPatchOwnOrgEvent() throws Exception {
        mvc.perform(patch("/v1/news/events/sabf-evt").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Edited\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Edited"));
    }

    @Test
    void staffCanStillMoveAnArticleBetweenOrgs() throws Exception {
        mvc.perform(patch("/v1/articles/trama-art").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"organization\":\"sabf\"}"))
            .andExpect(status().isOk());
    }

    // Followers expose names/emails: org admins and staff only, not plain members.
    @Test
    void plainMemberCannotListFollowers() throws Exception {
        mvc.perform(get("/v1/organizations/sabf/followers").with(member()))
            .andExpect(status().isForbidden());
    }

    @Test
    void orgAdminCanListOwnOrgFollowers() throws Exception {
        mvc.perform(get("/v1/organizations/sabf/followers").with(orgAdmin()))
            .andExpect(status().isOk());
    }

    @Test
    void orgAdminCannotListAnotherOrgsFollowers() throws Exception {
        mvc.perform(get("/v1/organizations/trama/followers").with(orgAdmin()))
            .andExpect(status().isForbidden());
    }

    @Test
    void staffCanListAnyOrgsFollowers() throws Exception {
        mvc.perform(get("/v1/organizations/trama/followers").with(staff()))
            .andExpect(status().isOk());
    }
}
