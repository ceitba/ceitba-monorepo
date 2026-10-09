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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Connecting an organization's Gmail account (docs/ORGANIZATIONS.md) through
// the shared OAuth callback, with Google's token endpoint stubbed. Same
// configuration as MailAccountsIT, so the two share one Spring context.
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "mail.enabled=true",
    "mail.oauth.redirect-uri=https://ceitba.org.ar/api/v1/mail/accounts/oauth/callback",
    // 32 zero bytes
    "mail.oauth.token-encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
})
class OrgMailConnectIT {

    static final String MAIL_PAGE = "https://ceitba.org.ar/newsletter/mine/org/sabf/mail";
    static final String SEND_SCOPE = "openid email " + GoogleMailOAuthClient.SCOPE_SEND;

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired OrganizationRepository orgs;
    @Autowired UserOrganizationRepository memberships;
    @Autowired MailOAuthStateService states;
    @SpyBean GoogleMailOAuthClient google;

    UUID adminId;
    UUID memberId;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.mail_sender_account, public.user_organizations, public.organizations, "
            + "public.\"user\" CASCADE");
        orgs.save(new Organization("sabf", "SABF", "South American Business Forum"));
        orgs.save(new Organization("trama", "TRAMA", "TRAMA ITBA"));
        adminId = users.save(new User(UUID.randomUUID(), "carol@itba.edu.ar", "Carol")).getId();
        memberId = users.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice")).getId();
        memberships.save(new UserOrganization(adminId, "sabf", "admin"));
        memberships.save(new UserOrganization(memberId, "sabf", "member"));
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
            .andExpect(jsonPath("$.account.status").value("connected"));
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
}
