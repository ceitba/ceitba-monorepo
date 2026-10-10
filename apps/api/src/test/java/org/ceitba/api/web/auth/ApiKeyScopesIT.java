package org.ceitba.api.web.auth;

import org.ceitba.api.domain.CeitbaBranch;
import org.ceitba.api.domain.CeitbaStaff;
import org.ceitba.api.domain.CeitbaStaffRole;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.auth.ApiKeyService;
import org.ceitba.api.support.SharedPostgres;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Scoped user API keys (V62, ApiKeyScope): read-only keys cannot write, keys
// without "staff" lose STAFF powers, scoped keys cannot mint keys, and the
// owner must pass the session allowlist.
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "itba.api.use-fake=true"
})
class ApiKeyScopesIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired ApiKeyService apiKeys;
    @Autowired UserRepository users;
    @Autowired CeitbaStaffRepository staff;
    @Autowired PlatformTransactionManager tx;

    private User user(String email) {
        return users.save(new User(UUID.randomUUID(), email, email));
    }

    private User staffUser(String email) {
        return new TransactionTemplate(tx).execute(s -> {
            var u = users.save(new User(UUID.randomUUID(), email, email));
            staff.save(new CeitbaStaff(u, CeitbaBranch.IT, CeitbaStaffRole.MEMBER,
                OffsetDateTime.now().minusDays(1), OffsetDateTime.now().plusDays(30)));
            return u;
        });
    }

    private String key(User u, String... scopes) {
        return apiKeys.create(u, "test", 30, scopes.length == 0 ? null : List.of(scopes)).key();
    }

    @Test
    void readOnlyKeyCanReadButNotWrite() throws Exception {
        String k = key(user("reader-" + UUID.randomUUID() + "@itba.edu.ar"), "read");
        mvc.perform(get("/v1/auth/me").header(ApiKeyFilter.HEADER, k)).andExpect(status().isOk());
        mvc.perform(post("/v1/wiki/bookmarks/93.12").header(ApiKeyFilter.HEADER, k))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value(ApiKeyFilter.INSUFFICIENT_SCOPE));
        mvc.perform(post("/v1/auth/logout-all").header(ApiKeyFilter.HEADER, k))
            .andExpect(status().isForbidden());
    }

    @Test
    void readOnlyKeyMayRunReadStylePostQueries() throws Exception {
        String k = key(user("conflicts-" + UUID.randomUUID() + "@itba.edu.ar"), "read");
        mvc.perform(post("/v1/classrooms/conflicts").header(ApiKeyFilter.HEADER, k)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"classroom\":\"101\",\"building\":\"SDF\",\"day\":\"MONDAY\",\"hourFrom\":\"10:00\",\"hourTo\":\"12:00\"}"))
            .andExpect(r -> {
                if (r.getResponse().getStatus() == 403) throw new AssertionError("read-style POST was denied");
            });
    }

    @Test
    void writeScopeAllowsWrites() throws Exception {
        String k = key(user("writer-" + UUID.randomUUID() + "@itba.edu.ar"), "read", "write");
        mvc.perform(post("/v1/auth/logout-all").header(ApiKeyFilter.HEADER, k))
            .andExpect(status().isNoContent());
    }

    @Test
    void staffPowersNeedTheStaffScope() throws Exception {
        var s = staffUser("staffer-" + UUID.randomUUID() + "@itba.edu.ar");
        mvc.perform(get("/v1/staff").header(ApiKeyFilter.HEADER, key(s, "read")))
            .andExpect(status().isForbidden());
        mvc.perform(get("/v1/staff").header(ApiKeyFilter.HEADER, key(s, "read", "staff")))
            .andExpect(status().isOk());
        // Full-power (legacy) keys keep STAFF.
        mvc.perform(get("/v1/staff").header(ApiKeyFilter.HEADER, key(s)))
            .andExpect(status().isOk());
    }

    @Test
    void scopedKeysCannotManageKeys() throws Exception {
        var u = user("minter-" + UUID.randomUUID() + "@itba.edu.ar");
        String scoped = key(u, "read", "write");
        mvc.perform(post("/v1/auth/api-keys").header(ApiKeyFilter.HEADER, scoped)
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"escalate\"}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value(ApiKeyFilter.INSUFFICIENT_SCOPE));
        mvc.perform(delete("/v1/auth/api-keys/" + UUID.randomUUID()).header(ApiKeyFilter.HEADER, scoped))
            .andExpect(status().isForbidden());
        // Listing is a read and stays allowed.
        mvc.perform(get("/v1/auth/api-keys").header(ApiKeyFilter.HEADER, scoped))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].scopes[0]").value("read"));
    }

    @Test
    void aReadOnlyKeyCanRevokeItself() throws Exception {
        var created = apiKeys.create(user("selfrevoke-" + UUID.randomUUID() + "@itba.edu.ar"), "mcp", 30, List.of("read"));
        mvc.perform(delete("/v1/auth/api-keys/" + created.id()).header(ApiKeyFilter.HEADER, created.key()))
            .andExpect(status().isNoContent());
        // Revoked: the key no longer authenticates.
        mvc.perform(get("/v1/auth/me").header(ApiKeyFilter.HEADER, created.key()))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void keysOfNonAllowlistedOwnersAreRejected() throws Exception {
        String k = key(user("outsider-" + UUID.randomUUID() + "@gmail.com"), "read");
        mvc.perform(get("/v1/auth/me").header(ApiKeyFilter.HEADER, k))
            .andExpect(status().isForbidden());
        // Public routes keep working.
        mvc.perform(get("/v1/careers").header(ApiKeyFilter.HEADER, k)).andExpect(status().isOk());
    }

    @Test
    void createWithScopesOverHttp() throws Exception {
        var alice = jwt().jwt(t -> t.claim("email", "alice-scopes@itba.edu.ar").claim("name", "Alice"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
        mvc.perform(post("/v1/auth/api-keys").with(alice)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"mcp\",\"scopes\":[\"staff\"]}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.scopes.length()").value(2))
            .andExpect(jsonPath("$.scopes[0]").value("read"))
            .andExpect(jsonPath("$.scopes[1]").value("staff"));
        mvc.perform(post("/v1/auth/api-keys").with(alice)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"mcp\",\"scopes\":[\"admin\"]}"))
            .andExpect(status().isBadRequest());
    }
}
