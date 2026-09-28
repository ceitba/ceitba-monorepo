package org.ceitba.api.web.user;

import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.auth.ApiKeyService;
import org.ceitba.api.service.auth.RefreshTokenService;
import org.ceitba.api.service.user.AccountDeletionService;
import org.ceitba.api.service.user.LastActiveStaffException;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// DELETE /v1/me: personal rows go, shared wiki material stays (with the user
// row anonymized), other users are untouched, refresh tokens stop working.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "itba.api.use-fake=true"
})
class AccountDeletionIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired RefreshTokenService refreshTokens;
    @Autowired ApiKeyService apiKeys;
    @Autowired AccountDeletionService accountDeletion;
    @Autowired PlatformTransactionManager txManager;

    User alice;
    User bob;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.\"user\", public.subject, public.careers, public.organizations CASCADE");
        alice = users.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
        bob   = users.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));

        jdbc.update("INSERT INTO public.organizations (slug, name, full_name) VALUES ('ceitba', 'CEITBA', 'Centro de Estudiantes')");
        jdbc.update("INSERT INTO public.subject (id, name, updated_at) VALUES ('93.41', 'Algebra', now())");
        jdbc.update("INSERT INTO public.careers (id, name, updated_at) VALUES ('INF', 'Informatica', now())");

        for (User u : new User[] {alice, bob}) {
            seedPersonalData(u.getId());
        }
    }

    private void seedPersonalData(UUID u) {
        jdbc.update("INSERT INTO public.api_keys (user_id, name, key_hash, expires_at) VALUES (?, 'k', ?, now() + interval '1 day')",
            u, UUID.randomUUID().toString().replace("-", "") + "00000000000000000000000000000000");
        jdbc.update("INSERT INTO public.user_follows (user_id, org_slug) VALUES (?, 'ceitba')", u);
        jdbc.update("INSERT INTO public.user_organizations (user_id, org_slug) VALUES (?, 'ceitba')", u);
        jdbc.update("INSERT INTO public.saved_schedules (user_id, name, payload) VALUES (?, 's', '{}'::jsonb)", u);
        jdbc.update("""
            INSERT INTO public.share_sessions (token, creator_user_id) VALUES (?, ?)
            """, u.toString().substring(0, 16), u);
        jdbc.update("INSERT INTO wiki.subject_difficulty (subject_id, user_id, value, updated_at) VALUES ('93.41', ?, 3, now())", u);
        jdbc.update("INSERT INTO wiki.subject_bookmarks (subject_id, user_id) VALUES ('93.41', ?)", u);
        jdbc.update("INSERT INTO wiki.\"Subject_Bookmarks\" (subject_id, user_id) VALUES ('93.41', ?)", u);
        jdbc.update("""
            INSERT INTO public.ceitba_staff (user_id, branch, start, "end")
            VALUES (?, 'IT', now() - interval '1 day', now() + interval '1 day')
            """, u);
        refreshTokens.issueNewFamily(u, "device");
    }

    private MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder req, User u) {
        return req.with(jwt().jwt(t -> t.claim("email", u.getEmail()).claim("name", u.getName()))
            .authorities(new SimpleGrantedAuthority("ROLE_USER")));
    }

    private int count(String table, String column, UUID u) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table + " WHERE " + column + " = ?", Integer.class, u);
    }

    private void assertPersonalDataGone(UUID u) {
        assertThat(count("public.api_keys", "user_id", u)).isZero();
        assertThat(count("public.refresh_tokens", "user_id", u)).isZero();
        assertThat(count("public.user_follows", "user_id", u)).isZero();
        assertThat(count("public.user_organizations", "user_id", u)).isZero();
        assertThat(count("public.saved_schedules", "user_id", u)).isZero();
        assertThat(count("public.share_sessions", "creator_user_id", u)).isZero();
        assertThat(count("public.ceitba_staff", "user_id", u)).isZero();
        assertThat(count("wiki.subject_difficulty", "user_id", u)).isZero();
        assertThat(count("wiki.subject_bookmarks", "user_id", u)).isZero();
        assertThat(count("wiki.\"Subject_Bookmarks\"", "user_id", u)).isZero();
    }

    private void assertPersonalDataIntact(UUID u) {
        assertThat(count("public.api_keys", "user_id", u)).isEqualTo(1);
        assertThat(count("public.refresh_tokens", "user_id", u)).isEqualTo(1);
        assertThat(count("public.user_follows", "user_id", u)).isEqualTo(1);
        assertThat(count("public.saved_schedules", "user_id", u)).isEqualTo(1);
        assertThat(count("public.ceitba_staff", "user_id", u)).isEqualTo(1);
        assertThat(count("wiki.subject_bookmarks", "user_id", u)).isEqualTo(1);
    }

    @Test
    void deleteRequiresAuthentication() throws Exception {
        mvc.perform(delete("/v1/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void apiKeyCannotDeleteTheAccount() throws Exception {
        String key = apiKeys.create(alice, "script", 1).key();

        mvc.perform(delete("/v1/me").header("X-Api-Key", key))
            .andExpect(status().isForbidden());

        assertThat(users.findById(alice.getId())).isPresent();
        assertThat(count("public.api_keys", "user_id", alice.getId())).isEqualTo(2);
        assertThat(count("public.ceitba_staff", "user_id", alice.getId())).isEqualTo(1);
    }

    @Test
    void lastActiveStaffMemberCannotDeleteTheAccount() throws Exception {
        jdbc.update("DELETE FROM public.ceitba_staff WHERE user_id = ?", bob.getId());

        mvc.perform(as(delete("/v1/me"), alice))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("LastActiveStaff"));

        assertThat(users.findById(alice.getId())).isPresent();
        assertPersonalDataIntact(alice.getId());
    }

    @Test
    void staffMemberCanDeleteWhenAnotherStaffMemberRemains() throws Exception {
        // Both Alice and Bob are active staff (seed).
        mvc.perform(as(delete("/v1/me"), alice)).andExpect(status().isNoContent());

        assertThat(count("public.ceitba_staff", "user_id", bob.getId())).isEqualTo(1);
    }

    // The last two staff members delete their accounts at the same time. The
    // guard locks the active staff rows, so Bob's call waits for Alice's to
    // commit and then sees that he is the only one left.
    @Test
    void concurrentDeletionsCannotRemoveTheLastStaffMember() throws Exception {
        var tx = new TransactionTemplate(txManager);
        var aliceDeleted = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            var aliceCall = pool.submit(() -> tx.execute(status -> {
                accountDeletion.deleteAccount(alice.getId());
                aliceDeleted.countDown();
                try {
                    release.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return null;
            }));
            assertThat(aliceDeleted.await(10, TimeUnit.SECONDS)).isTrue();

            var bobCall = pool.submit(() -> accountDeletion.deleteAccount(bob.getId()));
            assertThatThrownBy(() -> bobCall.get(500, TimeUnit.MILLISECONDS))
                .as("Bob's guard must wait for Alice's uncommitted deletion")
                .isInstanceOf(TimeoutException.class);

            release.countDown();
            aliceCall.get(10, TimeUnit.SECONDS);
            assertThatThrownBy(() -> bobCall.get(10, TimeUnit.SECONDS))
                .isInstanceOf(ExecutionException.class)
                .hasCauseInstanceOf(LastActiveStaffException.class);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }

        assertThat(users.findById(alice.getId())).isEmpty();
        assertThat(users.findById(bob.getId())).isPresent();
        assertThat(count("public.ceitba_staff", "user_id", bob.getId())).isEqualTo(1);
    }

    @Test
    void userWithoutSharedContributionsIsHardDeleted() throws Exception {
        // Bob joined Alice's share session: that participation goes with her session.
        UUID aliceSession = jdbc.queryForObject(
            "SELECT id FROM public.share_sessions WHERE creator_user_id = ?", UUID.class, alice.getId());
        jdbc.update("INSERT INTO public.share_session_participants (session_id, user_id, display_name) VALUES (?, ?, 'Bob')",
            aliceSession, bob.getId());
        // Alice created an article: it stays, without an author link.
        jdbc.update("""
            INSERT INTO public.articles (id, title, excerpt, category, created_by)
            VALUES ('a1', 't', 'e', 'c', ?)
            """, alice.getId());

        mvc.perform(as(delete("/v1/me"), alice))
            .andExpect(status().isNoContent())
            .andExpect(header().exists("Set-Cookie"));

        assertThat(users.findById(alice.getId())).isEmpty();
        assertThat(users.findByEmail("alice@itba.edu.ar")).isEmpty();
        assertPersonalDataGone(alice.getId());
        assertThat(count("public.share_session_participants", "session_id", aliceSession)).isZero();
        assertThat(jdbc.queryForObject("SELECT created_by FROM public.articles WHERE id = 'a1'", UUID.class)).isNull();

        assertThat(users.findById(bob.getId())).isPresent();
        assertPersonalDataIntact(bob.getId());
    }

    @Test
    void userWithSharedContributionsIsAnonymized() throws Exception {
        UUID note = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO wiki.subject_note (id, subject_id, owner_name, link, uploader_id, updated_at)
            VALUES (?, '93.41', 'Prof', 'https://example.com/n', ?, now())
            """, note, alice.getId());
        jdbc.update("INSERT INTO wiki.subject_note_vote (note_id, user_id, type) VALUES (?, ?, 'LIKE')", note, bob.getId());
        UUID comment = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO wiki.subject_comment (id, subject_id, user_id, content, updated_at)
            VALUES (?, '93.41', ?, 'my comment', now())
            """, comment, alice.getId());
        jdbc.update("INSERT INTO wiki.subject_comment_vote (comment_id, user_id, type) VALUES (?, ?, 'LIKE')", comment, bob.getId());
        jdbc.update("""
            INSERT INTO wiki.subject_wiki_edit_proposal (id, subject_id, proposed_by, proposed_content, status)
            VALUES (?, '93.41', ?, 'pending text', 'PENDING')
            """, UUID.randomUUID(), alice.getId());

        mvc.perform(as(delete("/v1/me"), alice)).andExpect(status().isNoContent());

        var tombstone = users.findById(alice.getId()).orElseThrow();
        assertThat(tombstone.getEmail()).isEqualTo("deleted-" + alice.getId() + "@deleted.invalid");
        assertThat(tombstone.getName()).isNull();
        assertThat(tombstone.getGoogleSub()).isNull();
        assertThat(tombstone.getAvatarUrl()).isNull();
        assertPersonalDataGone(alice.getId());

        // Shared note and Bob's vote on it survive; Alice's comment and the
        // votes on it, and her pending proposal, are gone.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.subject_note WHERE id = ?", Integer.class, note)).isEqualTo(1);
        assertThat(count("wiki.subject_note_vote", "user_id", bob.getId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.subject_comment WHERE id = ?", Integer.class, comment)).isZero();
        assertThat(count("wiki.subject_comment_vote", "user_id", bob.getId())).isZero();
        assertThat(count("wiki.subject_wiki_edit_proposal", "proposed_by", alice.getId())).isZero();

        assertPersonalDataIntact(bob.getId());
    }

    @Test
    void refreshTokensStopWorkingAfterDeletion() throws Exception {
        UUID familyUser = alice.getId();
        String token = refreshTokens.issueNewFamily(familyUser, "phone").token();

        mvc.perform(as(delete("/v1/me"), alice)).andExpect(status().isNoContent());

        mvc.perform(post("/v1/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + token + "\"}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void signingInAgainCreatesAFreshAccount() throws Exception {
        mvc.perform(as(delete("/v1/me"), alice)).andExpect(status().isNoContent());

        mvc.perform(as(get("/v1/auth/me"), alice))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value("alice@itba.edu.ar"))
            .andExpect(jsonPath("$.role").value("user"));
        var fresh = users.findByEmail("alice@itba.edu.ar").orElseThrow();
        assertThat(fresh.getId()).isNotEqualTo(alice.getId());
    }
}
