package org.ceitba.api.web.mail;

import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.http.Cookie;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.news.UserFollow;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.service.digest.DigestSender;
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
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.notNullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Open pixel / click redirects (public, never failing, no open redirect) and
// the STAFF quota/stats endpoints, end to end over a real database.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {"auth.allowed-domains=itba.edu.ar", "mail.daily-limit=3"})
class MailTrackingIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    static final String HOME = "https://ceitba.org.ar/newsletter";
    static final String ARTICLE_URL = HOME + "/articles/a-ceitba";
    static final String BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired OrganizationRepository orgs;
    @Autowired UserFollowRepository follows;
    @Autowired ArticleRepository articles;
    @Autowired DigestSender sender;
    @Autowired org.ceitba.api.service.mail.MailRetentionService retention;

    @BeforeEach
    void seed() {
        jdbc.execute("""
            TRUNCATE public.digest_deliveries, public.digest_issues, public.user_follows, public.mail_send_log,
                     public.mail_account_state, public.articles, public.news_events, public.organizations,
                     public."user" CASCADE
            """);
        var ceitba = orgs.save(new Organization("ceitba", "CEITBA", "Centro de Estudiantes"));
        User alice = users.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
        User bob = users.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));
        follows.save(new UserFollow(alice.getId(), "ceitba"));
        follows.save(new UserFollow(bob.getId(), "ceitba"));
        var a = new Article("a-ceitba", "Título a-ceitba", "Resumen", List.of("p"), "general", List.of("Autor"));
        a.setOrganization(ceitba);
        a.setPublishedAt(LocalDate.of(2026, 9, 30));
        a.setStatus("published");
        articles.save(a);
    }

    static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "alice@itba.edu.ar").claim("name", "Alice"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "bob@itba.edu.ar").claim("name", "Bob"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    String sentIssue() throws Exception {
        String body = mvc.perform(post("/v1/digests").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content("{\"weekStart\":\"2026-09-28\"}"))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(body, "$.id");
        mvc.perform(post("/v1/digests/" + id + "/send").with(staff())).andExpect(status().isAccepted());
        sender.runPending();   // logging transport: nothing leaves the process
        return id;
    }

    @Test
    void pixelAndRedirectArePublicAndNeverFailOnUnknownIds() throws Exception {
        // A stale session cookie must not turn them into 401s.
        var stale = new Cookie("ceitba_session", "not-a-jwt");
        mvc.perform(get("/v1/mail/o/AbCdEfGhIjKlMnOpQrStUv.gif").cookie(stale))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.IMAGE_GIF))
            .andExpect(header().string("Cache-Control", containsString("no-store")))
            .andExpect(header().string("Pragma", "no-cache"))
            .andExpect(result -> assertThat(result.getResponse().getContentAsByteArray()).hasSize(42));
        mvc.perform(get("/v1/mail/o/x")).andExpect(status().isOk());
        mvc.perform(head("/v1/mail/o/AbCdEfGhIjKlMnOpQrStUv.gif")).andExpect(status().isOk());

        mvc.perform(get("/v1/mail/c/AbCdEfGhIjKlMnOpQrStUv/1").cookie(stale))
            .andExpect(status().isFound())
            .andExpect(header().string("Location", HOME));
        mvc.perform(get("/v1/mail/c/whatever/abc")).andExpect(status().isFound())
            .andExpect(header().string("Location", HOME));
        // A URL in the query string is never followed.
        mvc.perform(get("/v1/mail/c/AbCdEfGhIjKlMnOpQrStUv/1?url=https://evil.example"))
            .andExpect(header().string("Location", HOME));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.mail_tracking_event", Long.class)).isZero();
    }

    @Test
    void retentionDeletesOldTrackingAndSendLogRowsOnly() throws Exception {
        String id = sentIssue();
        String t = jdbc.queryForObject(
            "SELECT tracking_id FROM public.digest_deliveries WHERE issue_id = ?::uuid AND status = 'sent' LIMIT 1",
            String.class, id);
        String other = jdbc.queryForObject(
            "SELECT tracking_id FROM public.digest_deliveries WHERE issue_id = ?::uuid AND status = 'sent' AND tracking_id <> ?",
            String.class, id, t);
        long sendLogBefore = jdbc.queryForObject("SELECT COUNT(*) FROM public.mail_send_log", Long.class);
        jdbc.update("INSERT INTO public.mail_send_log (account, kind, recipients, outcome, attempted_at) "
            + "VALUES ('x@itba.edu.ar', 'digest', 1, 'sent', now() - interval '40 days')");
        jdbc.update("INSERT INTO public.mail_tracking_event (tracking_id, type, at, ua_class) "
            + "VALUES (?, 'open', now() - interval '200 days', 'browser')", t);
        jdbc.update("INSERT INTO public.mail_tracking_event (tracking_id, type, at, ua_class) "
            + "VALUES (?, 'open', now() - interval '10 days', 'browser')", t);
        // t was sent 200 days ago, `other` just now: only t's per-delivery links go.
        jdbc.update("UPDATE public.digest_deliveries SET sent_at = now() - interval '200 days' WHERE tracking_id = ?", t);
        for (String tid : new String[] {t, other}) {
            jdbc.update("INSERT INTO public.digest_delivery_links (tracking_id, link_id, url, url_key, label) "
                + "VALUES (?, 1000, 'https://ceitba.org.ar/x', 'https://ceitba.org.ar/x', 'x')", tid);
        }

        retention.cleanup();

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.mail_send_log", Long.class)).isEqualTo(sendLogBefore);
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM public.mail_tracking_event WHERE tracking_id = ?", Long.class, t)).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT tracking_id FROM public.digest_delivery_links", String.class))
            .containsExactly(other);
        // The aggregates on the delivery itself survive.
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM public.digest_deliveries WHERE tracking_id = ?", Long.class, t)).isEqualTo(1);
    }

    @Test
    void sentIssueIsTrackedAndStatsAreAggregate() throws Exception {
        String id = sentIssue();

        var tracking = jdbc.queryForList(
            "SELECT tracking_id FROM public.digest_deliveries WHERE issue_id = ?::uuid AND status = 'sent'",
            String.class, id);
        assertThat(tracking).hasSize(2).allMatch(t -> t.length() == 22);
        // Outside the "within seconds of sending" window.
        jdbc.update("UPDATE public.digest_deliveries SET sent_at = now() - interval '1 hour'");
        Integer articleLink = jdbc.queryForObject(
            "SELECT link_id FROM public.digest_issue_links WHERE issue_id = ?::uuid AND url = ?",
            Integer.class, id, ARTICLE_URL);
        // The unsubscribe link is never tracked (it must always work).
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM public.digest_delivery_links WHERE url_key LIKE ?", Long.class, "%/unsubscribe%"))
            .isZero();

        String a = tracking.get(0);
        String b = tracking.get(1);
        mvc.perform(get("/v1/mail/o/" + a + ".gif").header("User-Agent", BROWSER)).andExpect(status().isOk());
        mvc.perform(get("/v1/mail/o/" + a + ".gif").header("User-Agent", BROWSER)).andExpect(status().isOk());
        mvc.perform(get("/v1/mail/c/" + a + "/" + articleLink).header("User-Agent", BROWSER))
            .andExpect(status().isFound())
            .andExpect(header().string("Location", ARTICLE_URL));
        // b: only a security scanner followed the link -> flagged, not counted.
        mvc.perform(get("/v1/mail/c/" + b + "/" + articleLink).header("User-Agent", "Barracuda Sentinel"))
            .andExpect(status().isFound())
            .andExpect(header().string("Location", ARTICLE_URL));
        // No per-reader link exists for these deliveries: id 1000 is unknown -> home.
        mvc.perform(get("/v1/mail/c/" + a + "/1000").header("User-Agent", BROWSER))
            .andExpect(status().isFound())
            .andExpect(header().string("Location", HOME));

        assertThat(jdbc.queryForMap("SELECT open_count, click_count FROM public.digest_deliveries WHERE tracking_id = ?", a))
            .containsEntry("open_count", 2).containsEntry("click_count", 1);
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM public.mail_tracking_event WHERE flagged AND flag_reason = 'scanner'", Long.class))
            .isEqualTo(1);

        mvc.perform(get("/v1/digests/" + id + "/stats").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.delivered").value(2))
            .andExpect(jsonPath("$.uniqueOpens").value(1))
            .andExpect(jsonPath("$.openRate").value(0.5))
            .andExpect(jsonPath("$.uniqueClicks").value(1))
            .andExpect(jsonPath("$.clickRate").value(0.5))
            .andExpect(jsonPath("$.clicksByLink[0].url").value(ARTICLE_URL))
            .andExpect(jsonPath("$.clicksByLink[0].label").value("Título a-ceitba"))
            .andExpect(jsonPath("$.clicksByLink[0].uniqueClicks").value(1))
            .andExpect(jsonPath("$.clicksByLink[0].totalClicks").value(1))
            .andExpect(jsonPath("$.clicksByLink.length()").value(1))
            .andExpect(jsonPath("$.opensByHour.length()").value(1))
            .andExpect(jsonPath("$.opensByHour[0].count").value(1));
        // Aggregates only: nothing that identifies a reader.
        String stats = mvc.perform(get("/v1/digests/" + id + "/stats").with(staff()))
            .andReturn().getResponse().getContentAsString();
        assertThat(stats).doesNotContain("alice").doesNotContain("bob").doesNotContain(a).doesNotContain("token=");

        mvc.perform(get("/v1/digests").with(staff()))
            .andExpect(jsonPath("$[0].openRate").value(0.5))
            .andExpect(jsonPath("$[0].clickRate").value(0.5))
            .andExpect(jsonPath("$[0].resumeAt").doesNotExist());
    }

    @Test
    void quotaIsSharedWithTestSendsWhichGet429WhenItRunsOut() throws Exception {
        sentIssue();   // 2 of 3 used
        mvc.perform(get("/v1/digests/quota").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.account").value("ceitba@itba.edu.ar"))
            .andExpect(jsonPath("$.limit").value(3))
            .andExpect(jsonPath("$.usedLast24h").value(2))
            .andExpect(jsonPath("$.remaining").value(1))
            .andExpect(jsonPath("$.pausedUntil").doesNotExist())
            .andExpect(jsonPath("$.nextCapacityAt").doesNotExist());

        String id = jdbc.queryForObject("SELECT id::text FROM public.digest_issues", String.class);
        mvc.perform(post("/v1/digests/" + id + "/test").with(staff())).andExpect(status().isOk());
        mvc.perform(post("/v1/digests/" + id + "/test").with(staff()))
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.error").value("MAIL_QUOTA_EXHAUSTED"))
            .andExpect(jsonPath("$.resumeAt").value(notNullValue()))
            .andExpect(header().exists("Retry-After"));

        mvc.perform(get("/v1/digests/quota").with(staff()))
            .andExpect(jsonPath("$.remaining").value(0))
            .andExpect(jsonPath("$.nextCapacityAt").value(notNullValue()));
        assertThat(jdbc.queryForList("SELECT kind FROM public.mail_send_log ORDER BY id", String.class))
            .containsExactly("digest", "digest", "test");
    }

    @Test
    void quotaAndStatsAreStaffOnly() throws Exception {
        String id = UUID.randomUUID().toString();
        mvc.perform(get("/v1/digests/quota")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/digests/quota").with(user())).andExpect(status().isForbidden());
        mvc.perform(get("/v1/digests/" + id + "/stats")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/digests/" + id + "/stats").with(user())).andExpect(status().isForbidden());
        mvc.perform(get("/v1/digests/" + id + "/stats").with(staff())).andExpect(status().isNotFound());
    }
}
