package org.ceitba.api.web.news;

import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.push.FakePushGateway;
import org.ceitba.api.service.push.FakePushGatewayConfig;
import org.ceitba.api.service.push.FcmPushNotificationService;
import org.ceitba.api.service.push.PushGateway;
import org.ceitba.api.service.push.PushMessage;
import org.ceitba.api.service.push.PushNotificationService;
import org.ceitba.api.service.push.events.PushToOrgFollowers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Publishing newsletter content pushes to the organization's followers only:
// after commit, asynchronously, once per publication, pruning dead tokens.
@SpringBootTest
@AutoConfigureMockMvc
@Import(FakePushGatewayConfig.class)
class PushTriggerIT {

    private static final Duration WAIT = Duration.ofSeconds(10);
    private static final Duration QUIET = Duration.ofMillis(700);

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired FakePushGateway gateway;
    @Autowired PushNotificationService pushService;
    @Autowired ApplicationEventPublisher events;
    @Autowired TransactionTemplate tx;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.\"user\", public.organizations, public.articles, public.news_events CASCADE");
        gateway.reset();

        jdbc.update("INSERT INTO public.organizations (slug, name, full_name) VALUES ('it', 'IT', 'IT Branch')");
        jdbc.update("INSERT INTO public.organizations (slug, name, full_name) VALUES ('other', 'Other', 'Other Org')");

        User alice = users.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
        User bob   = users.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));
        User carol = users.save(new User(UUID.randomUUID(), "carol@itba.edu.ar", "Carol"));
        follow(alice, "it");
        follow(bob, "other");
        follow(carol, "it");
        device("alice-phone", alice);
        device("alice-tablet", alice);
        device("bob-phone", bob);
        // carol follows "it" but has no device registered.
    }

    private void follow(User u, String org) {
        jdbc.update("INSERT INTO public.user_follows (user_id, org_slug) VALUES (?, ?)", u.getId(), org);
    }

    private void device(String token, User u) {
        jdbc.update("INSERT INTO public.user_devices (token, user_id, platform) VALUES (?, ?, 'android')",
            token, u.getId());
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar").claim("name", "Boss"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    private void createArticle(String id, String org, String status) throws Exception {
        String orgJson = org == null ? "null" : "\"" + org + "\"";
        mvc.perform(post("/v1/articles").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"id":"%s","title":"Convocatoria abierta","excerpt":"e","body":["p"],
                     "category":"General","organization":%s,"authors":["IT"],"status":"%s"}
                    """.formatted(id, orgJson, status)))
            .andExpect(status().isCreated());
    }

    private void awaitCalls(int n) {
        await().atMost(WAIT).until(() -> gateway.calls().size() >= n);
    }

    private void assertNoPushFor(Duration quiet) {
        await().during(quiet).atMost(quiet.plusSeconds(2)).until(() -> gateway.calls().isEmpty());
    }

    @Test
    void theFcmServiceIsWiredWhenAGatewayExists() {
        assertThat(pushService).isInstanceOf(FcmPushNotificationService.class);
    }

    @Test
    void publishingAnArticleTargetsOnlyTheOrgFollowersDevices() throws Exception {
        createArticle("art-1", "it", "published");

        awaitCalls(1);
        var call = gateway.calls().get(0);
        assertThat(call.tokens()).containsExactlyInAnyOrder("alice-phone", "alice-tablet");
        assertThat(call.message().title()).isEqualTo("IT");
        assertThat(call.message().body()).isEqualTo("Convocatoria abierta");
        assertThat(call.message().data())
            .containsEntry("type", "article").containsEntry("id", "art-1").containsEntry("org", "it");
        assertNoMoreCallsThan(1);
    }

    @Test
    void aDraftDoesNotPushUntilItIsPublishedAndEditsDoNotRepush() throws Exception {
        createArticle("art-2", "it", "draft");
        assertNoPushFor(QUIET);

        mvc.perform(patch("/v1/articles/art-2").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"published\"}"))
            .andExpect(status().isOk());
        awaitCalls(1);
        assertThat(gateway.calls().get(0).tokens()).containsExactlyInAnyOrder("alice-phone", "alice-tablet");

        mvc.perform(patch("/v1/articles/art-2").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Convocatoria (actualizada)\"}"))
            .andExpect(status().isOk());
        assertNoMoreCallsThan(1);
    }

    // One push per article: unpublishing and republishing it does not
    // announce it again (for 'ceitba' that would reach every user).
    @Test
    void republishingAnArticleDoesNotPushAgain() throws Exception {
        createArticle("art-4", "it", "published");
        awaitCalls(1);

        for (String status : new String[] {"draft", "published"}) {
            mvc.perform(patch("/v1/articles/art-4").with(staff())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"status\":\"" + status + "\"}"))
                .andExpect(status().isOk());
        }
        assertNoMoreCallsThan(1);
        assertThat(jdbc.queryForObject("SELECT push_sent_at FROM public.articles WHERE id = 'art-4'",
            OffsetDateTime.class)).isNotNull();
    }

    // Runs the exact backfill statement of V27 (the test mirror V4.20 is
    // DDL-only): published articles count as announced, also legacy rows
    // whose nullable created_at is NULL; drafts stay unannounced.
    @Test
    void v27BackfillMarksPublishedArticlesAsAnnounced() throws Exception {
        jdbc.update("""
            INSERT INTO public.articles (id, title, excerpt, category, status, created_at)
            VALUES ('old-dated', 't', 'e', 'news', 'published', '2024-01-01T00:00:00Z'),
                   ('old-undated', 't', 'e', 'news', 'published', NULL),
                   ('old-draft', 't', 'e', 'news', 'draft', '2024-01-01T00:00:00Z')
            """);

        String sql = new ClassPathResource("db/migration/V27__article_push_sent_at.sql")
            .getContentAsString(StandardCharsets.UTF_8);
        int start = sql.indexOf("UPDATE \"public\".\"articles\"");
        assertThat(start).as("V27 backfill statement").isNotNegative();
        jdbc.execute(sql.substring(start));

        assertThat(pushSentAt("old-dated")).isEqualTo(OffsetDateTime.parse("2024-01-01T00:00:00Z"));
        assertThat(pushSentAt("old-undated")).isNotNull();
        assertThat(pushSentAt("old-draft")).isNull();
    }

    private OffsetDateTime pushSentAt(String articleId) {
        return jdbc.queryForObject("SELECT push_sent_at FROM public.articles WHERE id = ?",
            OffsetDateTime.class, articleId);
    }

    @Test
    void anArticleWithoutOrganizationDoesNotPush() throws Exception {
        createArticle("art-3", null, "published");
        assertNoPushFor(QUIET);
    }

    @Test
    void creatingANewsEventPushesToFollowers() throws Exception {
        mvc.perform(post("/v1/news/events").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"id":"ev-1","title":"Charla de bienvenida","eventDate":"2026-10-01",
                     "startTime":"18:00","endTime":"19:00","location":"Aula 101",
                     "category":"Cultura","organization":"other"}
                    """))
            .andExpect(status().isCreated());

        awaitCalls(1);
        var call = gateway.calls().get(0);
        assertThat(call.tokens()).containsExactly("bob-phone");
        assertThat(call.message().data()).containsEntry("type", "event").containsEntry("id", "ev-1");
    }

    @Test
    void aFailedRequestSendsNothing() throws Exception {
        mvc.perform(post("/v1/articles").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"t","excerpt":"e","body":["p"],"category":"General",
                     "organization":"missing-org","authors":["IT"],"status":"published"}
                    """))
            .andExpect(status().isNotFound());
        assertNoPushFor(QUIET);
    }

    @Test
    void triggersArePublishedOnlyAfterCommit() {
        var trigger = new PushToOrgFollowers("it", PushMessage.forResource("IT", "x", "article", "rb"));

        tx.executeWithoutResult(status -> {
            events.publishEvent(trigger);
            status.setRollbackOnly();
        });
        assertNoPushFor(QUIET);

        tx.executeWithoutResult(status -> events.publishEvent(trigger));
        awaitCalls(1);
        assertThat(gateway.calls().get(0).message().data()).containsEntry("id", "rb");
    }

    @Test
    void deadTokensReportedByFcmAreDeleted() throws Exception {
        gateway.answer("alice-tablet", PushGateway.Outcome.UNREGISTERED);

        createArticle("art-4", "it", "published");

        await().atMost(WAIT).until(() -> jdbc.queryForObject(
            "SELECT count(*) FROM public.user_devices WHERE token = 'alice-tablet'", Integer.class) == 0);
        assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM public.user_devices WHERE token = 'alice-phone'", Integer.class)).isEqualTo(1);
    }

    private void assertNoMoreCallsThan(int n) {
        await().during(QUIET).atMost(QUIET.plusSeconds(2)).until(() -> gateway.calls().size() == n);
    }
}
