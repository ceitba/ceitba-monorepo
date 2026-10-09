package org.ceitba.api.web.orgmail;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.ceitba.api.service.mail.GoogleMailOAuthClient;
import org.ceitba.api.service.mail.MailOAuthStateService;
import org.ceitba.api.service.orgmail.OrgAnnouncementSender;
import org.ceitba.api.service.orgmail.OrgMailUnsubscribeTokens;
import org.ceitba.api.support.SharedPostgres;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.util.Date;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Organizations' emails (docs/ORGANIZATIONS.md): connecting the org's Gmail
// account through the OAuth callback (Google's token endpoint stubbed), the
// announcement lifecycle through the worker (log-only transport: sends
// "succeed" without leaving the process), the weekly cap and opt-outs.
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "mail.oauth.redirect-uri=https://ceitba.org.ar/api/v1/mail/accounts/oauth/callback",
    // 32 zero bytes
    "mail.oauth.token-encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "org-mail.weekly-limit=1",
    "digest.send-interval=PT0S"
})
class OrgMailIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    static final String MAIL_PAGE = "https://ceitba.org.ar/newsletter/mine/org/sabf/mail";
    static final String SEND_SCOPE = "openid email " + GoogleMailOAuthClient.SCOPE_SEND;

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired OrganizationRepository orgs;
    @Autowired UserOrganizationRepository memberships;
    @Autowired MailOAuthStateService states;
    @Autowired OrgAnnouncementSender sender;
    @Autowired OrgMailUnsubscribeTokens tokens;
    @SpyBean GoogleMailOAuthClient google;

    UUID adminId;
    UUID memberId;
    UUID bobId;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.mail_sender_account, public.mail_account_state, public.mail_send_log, "
            + "public.org_announcements, public.org_mail_optouts, public.user_follows, public.user_organizations, "
            + "public.organizations, public.\"user\" CASCADE");
        orgs.save(new Organization("sabf", "SABF", "South American Business Forum"));
        orgs.save(new Organization("trama", "TRAMA", "TRAMA ITBA"));
        adminId = users.save(new User(UUID.randomUUID(), "carol@itba.edu.ar", "Carol")).getId();
        memberId = users.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice")).getId();
        bobId = users.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob")).getId();
        var dave = users.save(new User(UUID.randomUUID(), "dave@itba.edu.ar", "Dave")).getId();
        var outsider = users.save(new User(UUID.randomUUID(), "eve@gmail.com", "Eve")).getId();
        memberships.save(new UserOrganization(adminId, "sabf", "admin"));
        memberships.save(new UserOrganization(memberId, "sabf", "member"));
        for (var u : new UUID[] { bobId, dave, outsider }) {
            jdbc.update("INSERT INTO public.user_follows (user_id, org_slug) VALUES (?, 'sabf')", u);
        }
        // Dave opted out; Eve is outside the allowed domains.
        jdbc.update("INSERT INTO public.org_mail_optouts (user_id, org_slug) VALUES (?, 'sabf')", dave);
        Mockito.reset(google);
    }

    private static RequestPostProcessor as(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", email))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static RequestPostProcessor admin()  { return as("carol@itba.edu.ar"); }
    private static RequestPostProcessor member() { return as("alice@itba.edu.ar"); }

    GoogleMailOAuthClient.Tokens tokensFor(String email) throws Exception {
        var claims = new JWTClaimsSet.Builder().issuer("https://accounts.google.com").audience("test-client-id")
            .claim("email", email).claim("email_verified", true)
            .expirationTime(new Date(System.currentTimeMillis() + 3_600_000)).build();
        var jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        jwt.sign(new MACSigner("0123456789abcdef0123456789abcdef"));
        return new GoogleMailOAuthClient.Tokens("access", "1//refresh", jwt.serialize(), SEND_SCOPE, 3600);
    }

    private void connectedAccount(String email) {
        jdbc.update("""
            INSERT INTO public.mail_sender_account (email, owner_type, owner_ref, refresh_token_enc, scopes)
            VALUES (?, 'organization', 'sabf', 'x', 'gmail.send')
            """, email);
    }

    // ---- connecting the account

    @Test
    void onlyTheOrgsAdminsConnectAndAnyDomainAccountCanBePicked() throws Exception {
        Mockito.doReturn(true).when(google).configured();
        mvc.perform(post("/v1/organizations/sabf/mail/connect").with(member())).andExpect(status().isForbidden());
        mvc.perform(post("/v1/organizations/sabf/mail/connect").with(admin()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.authorizationUrl", containsString("hd=itba.edu.ar")))
            .andExpect(jsonPath("$.authorizationUrl", not(containsString("login_hint"))));
    }

    @Test
    void callbackStoresTheOrgsAccountAndRedirectsToItsMailPage() throws Exception {
        Mockito.doReturn(tokensFor("sabf@itba.edu.ar")).when(google).exchangeCode("org-code");
        mvc.perform(get("/v1/mail/accounts/oauth/callback").param("code", "org-code")
                .param("state", states.issue(adminId, "sabf")))
            .andExpect(status().isFound())
            .andExpect(header().string("Location", MAIL_PAGE + "?mail=connected"));

        assertThat(jdbc.queryForObject(
            "SELECT owner_ref FROM public.mail_sender_account WHERE owner_type = 'organization' AND email = 'sabf@itba.edu.ar'",
            String.class)).isEqualTo("sabf");
        mvc.perform(get("/v1/organizations/sabf/mail").with(admin()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.account.email").value("sabf@itba.edu.ar"))
            .andExpect(jsonPath("$.recipientEstimate").value(1));
    }

    @Test
    void callbackRefusesOtherDomainsNonAdminsAndAnAccountInUse() throws Exception {
        Mockito.doReturn(tokensFor("sabf@gmail.com")).when(google).exchangeCode("gmail");
        mvc.perform(get("/v1/mail/accounts/oauth/callback").param("code", "gmail")
                .param("state", states.issue(adminId, "sabf")))
            .andExpect(header().string("Location", MAIL_PAGE + "?mail=error&reason=wrong_domain"));

        mvc.perform(get("/v1/mail/accounts/oauth/callback").param("code", "x")
                .param("state", states.issue(memberId, "sabf")))
            .andExpect(header().string("Location", MAIL_PAGE + "?mail=error&reason=not_org_admin"));

        jdbc.update("""
            INSERT INTO public.mail_sender_account (email, owner_type, owner_ref, refresh_token_enc, scopes)
            VALUES ('shared@itba.edu.ar', 'organization', 'trama', 'x', 'gmail.send')
            """);
        Mockito.doReturn(tokensFor("shared@itba.edu.ar")).when(google).exchangeCode("shared");
        mvc.perform(get("/v1/mail/accounts/oauth/callback").param("code", "shared")
                .param("state", states.issue(adminId, "sabf")))
            .andExpect(header().string("Location", MAIL_PAGE + "?mail=error&reason=account_in_use"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public.mail_sender_account WHERE owner_ref = 'sabf'",
            Integer.class)).isZero();
    }

    // ---- announcements

    private long draft(String subject) throws Exception {
        var res = mvc.perform(post("/v1/organizations/sabf/announcements").with(admin())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"subject\":\"" + subject + "\",\"body\":\"Hola!\\n\\nInscribite en https://sabf.org.ar\"}"))
            .andExpect(status().isCreated())
            .andReturn();
        return Long.parseLong(com.jayway.jsonpath.JsonPath.read(res.getResponse().getContentAsString(), "$.id").toString());
    }

    @Test
    void sendingReachesFollowersWhoDidntOptOutWithinTheAllowedDomains() throws Exception {
        long id = draft("Convocatoria");
        mvc.perform(post("/v1/organizations/sabf/announcements/" + id + "/send").with(admin()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("OrgMailNotConnected"));

        connectedAccount("sabf@itba.edu.ar");
        mvc.perform(post("/v1/organizations/sabf/announcements/" + id + "/test").with(admin()))
            .andExpect(status().isNoContent());
        mvc.perform(post("/v1/organizations/sabf/announcements/" + id + "/send").with(admin()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("sending"))
            .andExpect(jsonPath("$.recipientCount").value(1));

        sender.runPending();

        mvc.perform(get("/v1/organizations/sabf/announcements").with(admin()))
            .andExpect(jsonPath("$[0].status").value("sent"))
            .andExpect(jsonPath("$[0].sent").value(1));
        assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM public.org_announcement_deliveries WHERE user_id = ? AND status = 'sent'",
            Integer.class, bobId)).isEqualTo(1);
        // Test and announcement both count toward the org account's quota, not CEITBA's.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public.mail_send_log WHERE account = 'sabf@itba.edu.ar'",
            Integer.class)).isEqualTo(2);
    }

    @Test
    void anOrgSendsAtMostTheWeeklyLimitAndOnlyAdminsManageEmails() throws Exception {
        connectedAccount("sabf@itba.edu.ar");
        long first = draft("Primera");
        long second = draft("Segunda");
        mvc.perform(post("/v1/organizations/sabf/announcements/" + first + "/send").with(admin()))
            .andExpect(status().isOk());
        mvc.perform(post("/v1/organizations/sabf/announcements/" + second + "/send").with(admin()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("OrgMailWeeklyLimit"));
        mvc.perform(post("/v1/organizations/sabf/announcements/" + first + "/send").with(admin()))
            .andExpect(jsonPath("$.error").value("OrgMailNotDraft"));

        mvc.perform(get("/v1/organizations/sabf/announcements").with(member())).andExpect(status().isForbidden());
        mvc.perform(get("/v1/organizations/sabf/mail").with(member())).andExpect(status().isForbidden());
    }

    // ---- opt-outs

    @Test
    void oneClickUnsubscribeOptsOutOfThatOrgOnly() throws Exception {
        mvc.perform(post("/v1/org-mail/unsubscribe").param("token", tokens.issue(bobId, "sabf")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.organization").value("SABF"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public.org_mail_optouts WHERE user_id = ?",
            Integer.class, bobId)).isEqualTo(1);

        String forged = tokens.issue(bobId, "sabf").replace(".sabf.", ".trama.");
        mvc.perform(post("/v1/org-mail/unsubscribe").param("token", forged)).andExpect(status().isBadRequest());
    }

    @Test
    void followersSwitchAnOrgsEmailsOnAndOff() throws Exception {
        mvc.perform(put("/v1/me/follows/sabf/mail").with(as("bob@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":false}"))
            .andExpect(status().isOk());
        mvc.perform(get("/v1/me/follows/sabf/mail").with(as("bob@itba.edu.ar")))
            .andExpect(jsonPath("$.enabled").value(false));
        mvc.perform(put("/v1/me/follows/sabf/mail").with(as("bob@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":true}"))
            .andExpect(status().isOk());
        mvc.perform(get("/v1/me/follows/sabf/mail").with(as("bob@itba.edu.ar")))
            .andExpect(jsonPath("$.enabled").value(true));
    }
}
