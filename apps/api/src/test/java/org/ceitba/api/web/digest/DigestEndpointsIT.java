package org.ceitba.api.web.digest;

import com.jayway.jsonpath.JsonPath;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.news.UserFollow;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.digest.DigestDeliveryRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.service.digest.DigestSender;
import org.ceitba.api.service.digest.DigestUnsubscribeTokens;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
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
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {"auth.allowed-domains=itba.edu.ar", "auth.allowed-emails=boss@gmail.com"})
class DigestEndpointsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    // Monday 2026-09-28: articles of 28/9..4/10, events of 5/10..11/10.
    static final String WEEK = "2026-09-28";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired OrganizationRepository orgs;
    @Autowired UserFollowRepository follows;
    @Autowired ArticleRepository articles;
    @Autowired NewsEventRepository events;
    @Autowired DigestDeliveryRepository deliveries;
    @Autowired DigestUnsubscribeTokens tokens;
    @Autowired DigestSender sender;

    User alice;
    User bob;

    @BeforeEach
    void seed() {
        jdbc.execute("""
            TRUNCATE public.digest_deliveries, public.digest_issues, public.user_follows, public.mail_send_log, public.mail_account_state,
                     public.articles, public.news_events, public.organizations, public."user",
                     public.capability_settings, public.capability_user_grants CASCADE
            """);
        // The digest is behind resumen_semanal; most tests run with it open to everyone.
        setDigestOpenToAll(true);
        var ceitba = orgs.save(new Organization("ceitba", "CEITBA", "Centro de Estudiantes"));
        var sabf = orgs.save(new Organization("sabf", "SABF", "South American Business Forum"));

        alice = users.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));   // follows ceitba
        bob = users.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));         // ceitba + sabf
        var dave = users.save(new User(UUID.randomUUID(), "dave@itba.edu.ar", "Dave"));  // only sabf
        var carol = users.save(new User(UUID.randomUUID(), "carol@gmail.com", "Carol")); // not allowed
        follows.save(new UserFollow(alice.getId(), "ceitba"));
        follows.save(new UserFollow(bob.getId(), "ceitba"));
        follows.save(new UserFollow(bob.getId(), "sabf"));
        follows.save(new UserFollow(dave.getId(), "sabf"));
        follows.save(new UserFollow(carol.getId(), "ceitba"));

        article("a-ceitba", ceitba, LocalDate.of(2026, 9, 30), "published");
        article("a-sabf", sabf, LocalDate.of(2026, 10, 2), "published");
        article("a-indep", null, LocalDate.of(2026, 9, 29), "published");
        article("a-draft", ceitba, LocalDate.of(2026, 10, 1), "draft");
        article("a-old", ceitba, LocalDate.of(2026, 9, 27), "published");
        event("e-ceitba", ceitba, LocalDate.of(2026, 10, 6));
        event("e-general", null, LocalDate.of(2026, 10, 9));
        event("e-late", ceitba, LocalDate.of(2026, 10, 12));
    }

    void setDigestOpenToAll(boolean open) {
        jdbc.update("""
            INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('resumen_semanal', ?)
            ON CONFLICT (capability) DO UPDATE SET enabled_for_all = EXCLUDED.enabled_for_all
            """, open);
    }

    void article(String id, Organization org, LocalDate publishedAt, String status) {
        var a = new Article(id, "Título " + id, "Resumen", List.of("p"), "general", List.of("Autor"));
        a.setOrganization(org);
        a.setPublishedAt(publishedAt);
        a.setStatus(status);
        articles.save(a);
    }

    void event(String id, Organization org, LocalDate date) {
        var e = new NewsEvent(id, "Evento " + id, date, LocalTime.of(18, 0), LocalTime.of(20, 0), "Aula 101", "general");
        e.setOrganization(org);
        events.save(e);
    }

    static RequestPostProcessor staff(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", "Staff"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    static RequestPostProcessor staff() {
        return staff("alice@itba.edu.ar");
    }

    static RequestPostProcessor user() {
        return userAs("bob@itba.edu.ar");
    }

    static RequestPostProcessor userAs(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", "Bob"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    String create() throws Exception {
        String body = mvc.perform(post("/v1/digests").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content("{\"weekStart\":\"" + WEEK + "\"}"))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }

    @Test
    void issueEndpointsAreStaffOnly() throws Exception {
        mvc.perform(get("/v1/digests")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/digests").with(user())).andExpect(status().isForbidden());
        mvc.perform(post("/v1/digests").with(user())
                .contentType(MediaType.APPLICATION_JSON).content("{\"weekStart\":\"" + WEEK + "\"}"))
            .andExpect(status().isForbidden());
        String id = create();
        mvc.perform(get("/v1/digests/" + id).with(user())).andExpect(status().isForbidden());
        mvc.perform(post("/v1/digests/" + id + "/send").with(user())).andExpect(status().isForbidden());
        mvc.perform(get("/v1/digests/" + id + "/preview")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/digests").with(staff())).andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value(id))
            .andExpect(jsonPath("$[0].weekEnd").value("2026-10-04"))
            .andExpect(jsonPath("$[0].counts.pending").value(0));
    }

    @Test
    void createValidatesWeekAndUniqueness() throws Exception {
        mvc.perform(post("/v1/digests").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content("{\"weekStart\":\"2026-09-29\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_WEEK_START"));
        create();
        mvc.perform(post("/v1/digests").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content("{\"weekStart\":\"" + WEEK + "\"}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("DIGEST_EXISTS"));
    }

    @Test
    void detailListsCandidatesAndPatchAcceptsTheFullBody() throws Exception {
        String id = create();
        mvc.perform(get("/v1/digests/" + id).with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.subject").value("La semana en ITBA · 28 de septiembre al 4 de octubre"))
            .andExpect(jsonPath("$.status").value("draft"))
            .andExpect(jsonPath("$.articles.length()").value(3))
            .andExpect(jsonPath("$.articles[0].id").value("a-sabf"))
            .andExpect(jsonPath("$.articles[0].organization.name").value("SABF"))
            .andExpect(jsonPath("$.articles[2].id").value("a-indep"))
            .andExpect(jsonPath("$.articles[2].organization").doesNotExist())
            .andExpect(jsonPath("$.events.length()").value(2))
            .andExpect(jsonPath("$.events[0].id").value("e-ceitba"))
            .andExpect(jsonPath("$.events[0].startTime").value("18:00:00"))
            .andExpect(jsonPath("$.events[1].id").value("e-general"))
            // CEITBA followers on an allowed domain: alice and bob
            .andExpect(jsonPath("$.recipientEstimate").value(2));

        // What the frontend sends on every save: all five fields.
        String autoSendAt = java.time.Instant.now().plus(java.time.Duration.ofDays(2))
            .truncatedTo(java.time.temporal.ChronoUnit.MINUTES).toString();
        mvc.perform(patch("/v1/digests/" + id).with(staff()).contentType(MediaType.APPLICATION_JSON).content("""
                {"subject":"Edición especial","intro":"Hola\\n<b>todos</b>",
                 "excludedArticleIds":["a-sabf"],"excludedEventIds":[],
                 "autoSendAt":"%s"}
                """.formatted(autoSendAt)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.subject").value("Edición especial"))
            .andExpect(jsonPath("$.intro").value("Hola\n<b>todos</b>"))
            .andExpect(jsonPath("$.autoSendAt").value(containsString(autoSendAt.substring(0, 16))))
            .andExpect(jsonPath("$.articles[0].excluded").value(true))
            .andExpect(jsonPath("$.articles[1].excluded").value(false))
            .andExpect(jsonPath("$.recipientEstimate").value(2));

        mvc.perform(patch("/v1/digests/" + id).with(staff()).contentType(MediaType.APPLICATION_JSON).content("""
                {"subject":"Edición especial","intro":null,"excludedArticleIds":["a-sabf"],
                 "excludedEventIds":[],"autoSendAt":null}
                """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.autoSendAt").doesNotExist())
            .andExpect(jsonPath("$.intro").doesNotExist());

        mvc.perform(get("/v1/digests/" + id + "/preview").with(staff()))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_HTML))
            .andExpect(content().string(containsString("Título a-ceitba")))
            .andExpect(content().string(containsString("Evento e-general")))
            .andExpect(content().string(containsString("seguís a CEITBA en ITBA News")));
        // `mode` is accepted and ignored.
        mvc.perform(get("/v1/digests/" + id + "/preview?mode=me").with(staff()))
            .andExpect(status().isOk())
            .andExpect(content().string(org.hamcrest.Matchers.not(containsString("Título a-sabf"))));
    }

    @Test
    void sendingAnEmptyIssueIsRefused() throws Exception {
        String id = create();
        mvc.perform(patch("/v1/digests/" + id).with(staff()).contentType(MediaType.APPLICATION_JSON).content("""
                {"excludedArticleIds":["a-ceitba","a-sabf","a-indep"],"excludedEventIds":["e-ceitba","e-general"]}
                """))
            .andExpect(status().isOk());
        mvc.perform(post("/v1/digests/" + id + "/send").with(staff()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("DIGEST_EMPTY"));
    }

    @Test
    void testSendHonoursTheDomainGuard() throws Exception {
        String id = create();
        mvc.perform(post("/v1/digests/" + id + "/test").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sentTo").value("alice@itba.edu.ar"));
        // Allowlisted to sign in, but not a digest domain.
        mvc.perform(post("/v1/digests/" + id + "/test").with(staff("boss@gmail.com")))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.error").value("EMAIL_NOT_ALLOWED"));
    }

    @Test
    void sendSnapshotsRecipientsThenLocksTheIssue() throws Exception {
        String id = create();
        mvc.perform(post("/v1/digests/" + id + "/send").with(staff()))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.status").value("sending"))
            .andExpect(jsonPath("$.counts.pending").value(2))
            .andExpect(jsonPath("$.recipientEstimate").doesNotExist());

        mvc.perform(patch("/v1/digests/" + id).with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"subject\":\"x\"}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("DIGEST_NOT_EDITABLE"));
        mvc.perform(post("/v1/digests/" + id + "/send").with(staff()))
            .andExpect(status().isConflict());

        sender.runPending();   // logging sender: nothing leaves the process

        mvc.perform(get("/v1/digests/" + id).with(staff()))
            .andExpect(jsonPath("$.status").value("sent"))
            .andExpect(jsonPath("$.sentAt").exists())
            .andExpect(jsonPath("$.counts.sent").value(2))
            .andExpect(jsonPath("$.counts.pending").value(0));
        mvc.perform(post("/v1/digests/" + id + "/cancel").with(staff()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("DIGEST_NOT_EDITABLE"));
    }

    @Test
    void cancelWhileSendingDropsWhatIsLeft() throws Exception {
        String id = create();
        mvc.perform(post("/v1/digests/" + id + "/send").with(staff())).andExpect(status().isAccepted());
        // One email already went out when staff press "Detener envío".
        deliveries.markSending(UUID.fromString(id), alice.getId(), OffsetDateTime.now());
        deliveries.markSent(UUID.fromString(id), alice.getId(), OffsetDateTime.now());

        mvc.perform(post("/v1/digests/" + id + "/cancel").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("cancelled"))
            .andExpect(jsonPath("$.counts.sent").value(1))
            .andExpect(jsonPath("$.counts.pending").value(0));

        sender.runPending();
        assertThat(deliveries.findAll()).hasSize(1).allMatch(d -> d.getStatus().equals("sent"));

        mvc.perform(post("/v1/digests/" + id + "/cancel").with(staff()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("DIGEST_NOT_EDITABLE"));
    }

    @Test
    void withoutTheCapabilityOnlyHoldersGetEstimatedAndSubscribe() throws Exception {
        setDigestOpenToAll(false);
        // Plain USER, no grant: 403; unsubscribing stays open.
        mvc.perform(get("/v1/digests/subscription").with(user()))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.error").value("CAPABILITY_REQUIRED"));
        mvc.perform(put("/v1/digests/subscription").with(user())
                .contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":false}"))
            .andExpect(status().isForbidden());
        mvc.perform(post("/v1/digests/unsubscribe").param("token", tokens.issue(alice.getId()))
                .contentType(MediaType.APPLICATION_FORM_URLENCODED).content("List-Unsubscribe=One-Click"))
            .andExpect(status().isNoContent());

        // A grant on bob's email: the estimate counts only him (alice opted out above).
        jdbc.update("INSERT INTO public.capability_user_grants (capability, email) VALUES ('resumen_semanal', 'bob@itba.edu.ar')");
        mvc.perform(get("/v1/digests/subscription").with(user())).andExpect(status().isOk());
        String body = mvc.perform(post("/v1/digests").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content("{\"weekStart\":\"" + WEEK + "\"}"))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat((Number) JsonPath.read(body, "$.recipientEstimate")).isEqualTo(1);
    }

    @Test
    void subscriptionAndOneClickUnsubscribe() throws Exception {
        mvc.perform(get("/v1/digests/subscription")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/digests/subscription").with(user()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(true));
        mvc.perform(put("/v1/digests/subscription").with(user())
                .contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":false}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(false));
        assertThat(users.findById(bob.getId()).orElseThrow().isDigestEmailEnabled()).isFalse();
        // Only the flag is cleared: bob still follows CEITBA and SABF.
        assertThat(follows.existsByUserIdAndOrganization(bob.getId(), "ceitba")).isTrue();

        // The flag alone is not "subscribed": dave only follows SABF.
        var dave = users.findByEmail("dave@itba.edu.ar").orElseThrow();
        assertThat(follows.existsByUserIdAndOrganization(dave.getId(), "ceitba")).isFalse();
        mvc.perform(get("/v1/digests/subscription").with(userAs("dave@itba.edu.ar")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(false));
        // Opting in also follows CEITBA (idempotent).
        for (int i = 0; i < 2; i++) {
            mvc.perform(put("/v1/digests/subscription").with(userAs("dave@itba.edu.ar"))
                    .contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":true}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(true));
        }
        assertThat(follows.existsByUserIdAndOrganization(dave.getId(), "ceitba")).isTrue();

        // Public, RFC 8058 one-click POST (form body), no session.
        mvc.perform(post("/v1/digests/unsubscribe").param("token", tokens.issue(alice.getId()))
                .contentType(MediaType.APPLICATION_FORM_URLENCODED).content("List-Unsubscribe=One-Click"))
            .andExpect(status().isNoContent());
        assertThat(users.findById(alice.getId()).orElseThrow().isDigestEmailEnabled()).isFalse();

        mvc.perform(post("/v1/digests/unsubscribe?token=" + UUID.randomUUID() + ".AAAA"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_TOKEN"));
        mvc.perform(post("/v1/digests/unsubscribe"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_TOKEN"));
    }
}
