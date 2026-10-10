package org.ceitba.api.web.mail;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.ceitba.api.domain.CeitbaBranch;
import org.ceitba.api.domain.CeitbaStaff;
import org.ceitba.api.domain.CeitbaStaffRole;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.mail.GoogleMailOAuthClient;
import org.ceitba.api.service.mail.MailOAuthStateService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Gmail sender accounts: STAFF-only endpoints, the OAuth callback against a
// stubbed Google token endpoint (GoogleMailOAuthClient.exchangeCode; its
// authorization URL and id_token checks run for real), and that nothing
// secret leaves the API.
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "mail.enabled=true",
    "mail.oauth.redirect-uri=https://ceitba.org.ar/api/v1/mail/accounts/oauth/callback",
    // 32 zero bytes
    "mail.oauth.token-encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
})
class MailAccountsIT {

    static final String REFRESH_TOKEN = "1//super-secret-refresh-token";
    static final String HOME = "https://ceitba.org.ar/newsletter/admin/digests";

    @Autowired MockMvc mvc;
    @Autowired org.springframework.transaction.support.TransactionTemplate tx;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired CeitbaStaffRepository staff;
    @Autowired MailOAuthStateService states;
    @SpyBean GoogleMailOAuthClient google;

    UUID staffId;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.mail_sender_account, public.mail_account_state, public.ceitba_staff, "
            + "public.\"user\" CASCADE");
        // One transaction: the staff row maps the user's id (@MapsId).
        staffId = tx.execute(s -> {
            var alice = users.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
            staff.save(new CeitbaStaff(alice, CeitbaBranch.IT, CeitbaStaffRole.MEMBER,
                OffsetDateTime.now().minus(1, ChronoUnit.DAYS), OffsetDateTime.now().plus(30, ChronoUnit.DAYS)));
            return alice.getId();
        });
        Mockito.reset(google);
    }

    static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "alice@itba.edu.ar").claim("name", "Alice"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "bob@itba.edu.ar").claim("name", "Bob"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    // What Google's token endpoint returns for `email`.
    GoogleMailOAuthClient.Tokens tokensFor(String email, String scope, String refreshToken) throws Exception {
        var claims = new JWTClaimsSet.Builder().issuer("https://accounts.google.com").audience("test-client-id")
            .claim("email", email).claim("email_verified", true).claim("hd", "itba.edu.ar")
            .expirationTime(new Date(System.currentTimeMillis() + 3_600_000)).build();
        var jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        jwt.sign(new MACSigner("0123456789abcdef0123456789abcdef"));
        return new GoogleMailOAuthClient.Tokens("access", refreshToken, jwt.serialize(), scope, 3600);
    }

    static final String SEND_SCOPE = "openid https://www.googleapis.com/auth/userinfo.email "
        + GoogleMailOAuthClient.SCOPE_SEND;

    @Test
    void endpointsAreStaffOnly() throws Exception {
        mvc.perform(post("/v1/mail/accounts/ceitba/connect")).andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/mail/accounts/ceitba/connect").with(user())).andExpect(status().isForbidden());
        mvc.perform(get("/v1/mail/accounts").with(user())).andExpect(status().isForbidden());
        mvc.perform(delete("/v1/mail/accounts/1").with(user())).andExpect(status().isForbidden());
    }

    @Test
    void connectReturnsTheGoogleConsentUrl() throws Exception {
        Mockito.doReturn(true).when(google).configured();
        mvc.perform(post("/v1/mail/accounts/ceitba/connect").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.authorizationUrl", containsString("https://accounts.google.com/o/oauth2/v2/auth?")))
            .andExpect(jsonPath("$.authorizationUrl", containsString("access_type=offline")))
            .andExpect(jsonPath("$.authorizationUrl", containsString("prompt=consent")))
            .andExpect(jsonPath("$.authorizationUrl", containsString("login_hint=ceitba@itba.edu.ar")))
            .andExpect(jsonPath("$.authorizationUrl", containsString("hd=itba.edu.ar")))
            .andExpect(jsonPath("$.authorizationUrl", containsString("gmail.send%20openid%20email")))
            .andExpect(jsonPath("$.authorizationUrl", containsString("state=")));
    }

    @Test
    void callbackStoresTheEncryptedTokenAndListingHasNoSecrets() throws Exception {
        Mockito.doReturn(tokensFor("ceitba@itba.edu.ar", SEND_SCOPE, REFRESH_TOKEN))
            .when(google).exchangeCode("good-code");

        mvc.perform(get("/v1/mail/accounts/oauth/callback").param("code", "good-code")
                .param("state", states.issue(staffId)))
            .andExpect(status().isFound())
            .andExpect(header().string("Location", HOME + "?mail=connected"));

        String stored = jdbc.queryForObject("SELECT refresh_token_enc FROM public.mail_sender_account", String.class);
        assertThat(stored).isNotBlank().doesNotContain(REFRESH_TOKEN);

        mvc.perform(get("/v1/mail/accounts").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].email").value("ceitba@itba.edu.ar"))
            .andExpect(jsonPath("$[0].ownerType").value("ceitba"))
            .andExpect(jsonPath("$[0].status").value("connected"))
            .andExpect(jsonPath("$[0].refreshToken").doesNotExist())
            .andExpect(jsonPath("$[0].refreshTokenEnc").doesNotExist())
            .andExpect(jsonPath("$[0].scopes").doesNotExist())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content()
                .string(not(containsString(REFRESH_TOKEN))));

        mvc.perform(get("/v1/digests/quota").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.senderStatus").value("connected"));
    }

    @Test
    void callbackRejectsAnotherAccountABadStateAndAMissingScope() throws Exception {
        Mockito.doReturn(tokensFor("alice@itba.edu.ar", SEND_SCOPE, REFRESH_TOKEN)).when(google).exchangeCode("alice");
        mvc.perform(get("/v1/mail/accounts/oauth/callback").param("code", "alice").param("state", states.issue(staffId)))
            .andExpect(header().string("Location", HOME + "?mail=error&reason=wrong_account"));

        Mockito.doReturn(tokensFor("ceitba@itba.edu.ar", "openid email", REFRESH_TOKEN)).when(google).exchangeCode("noscope");
        mvc.perform(get("/v1/mail/accounts/oauth/callback").param("code", "noscope").param("state", states.issue(staffId)))
            .andExpect(header().string("Location", HOME + "?mail=error&reason=missing_scope"));

        mvc.perform(get("/v1/mail/accounts/oauth/callback").param("code", "x").param("state", "forged.state"))
            .andExpect(header().string("Location", HOME + "?mail=error&reason=invalid_state"));
        // A valid state of a user who is not (or no longer) staff.
        var bob = users.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));
        mvc.perform(get("/v1/mail/accounts/oauth/callback").param("code", "x").param("state", states.issue(bob.getId())))
            .andExpect(header().string("Location", HOME + "?mail=error&reason=not_staff"));
        mvc.perform(get("/v1/mail/accounts/oauth/callback").param("error", "access_denied").param("state", states.issue(staffId)))
            .andExpect(header().string("Location", HOME + "?mail=error&reason=access_denied"));

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.mail_sender_account", Long.class)).isZero();
        mvc.perform(get("/v1/digests/quota").with(staff())).andExpect(jsonPath("$.senderStatus").value("missing"));
    }

    @Test
    void testSendWithoutAConnectedSenderIs409AndDeleteRevokesAtGoogle() throws Exception {
        String body = mvc.perform(post("/v1/digests").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content("{\"weekStart\":\"2026-09-28\"}"))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = com.jayway.jsonpath.JsonPath.read(body, "$.id");
        mvc.perform(post("/v1/digests/" + id + "/test").with(staff()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("MAIL_SENDER_NOT_CONNECTED"));

        Mockito.doReturn(tokensFor("ceitba@itba.edu.ar", SEND_SCOPE, REFRESH_TOKEN)).when(google).exchangeCode("c");
        Mockito.doNothing().when(google).revoke(REFRESH_TOKEN);
        mvc.perform(get("/v1/mail/accounts/oauth/callback").param("code", "c").param("state", states.issue(staffId)))
            .andExpect(status().isFound());
        Long accountId = jdbc.queryForObject("SELECT id FROM public.mail_sender_account", Long.class);
        mvc.perform(delete("/v1/mail/accounts/" + accountId).with(staff())).andExpect(status().isNoContent());
        Mockito.verify(google).revoke(REFRESH_TOKEN);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.mail_sender_account", Long.class)).isZero();
    }
}
