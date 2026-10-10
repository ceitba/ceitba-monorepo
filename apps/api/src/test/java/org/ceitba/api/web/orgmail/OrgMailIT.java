package org.ceitba.api.web.orgmail;

import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.ceitba.api.service.orgmail.OrgAnnouncementSender;
import org.ceitba.api.service.orgmail.OrgMailUnsubscribeTokens;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Organizations' emails (docs/ORGANIZATIONS.md): the announcement lifecycle
// through the worker (the test config's log-only transport: sends "succeed"
// without leaving the process), the weekly cap and opt-outs. Connecting the
// account: OrgMailConnectIT.
@SpringBootTest
@AutoConfigureMockMvc
class OrgMailIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired OrganizationRepository orgs;
    @Autowired UserOrganizationRepository memberships;
    @Autowired OrgAnnouncementSender sender;
    @Autowired OrgMailUnsubscribeTokens tokens;

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
    }

    private static RequestPostProcessor as(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", email))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static RequestPostProcessor admin()  { return as("carol@itba.edu.ar"); }
    private static RequestPostProcessor member() { return as("alice@itba.edu.ar"); }

    private void connectedAccount(String email) {
        jdbc.update("""
            INSERT INTO public.mail_sender_account (email, owner_type, owner_ref, refresh_token_enc, scopes)
            VALUES (?, 'organization', 'sabf', 'x', 'gmail.send')
            """, email);
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
        // Counted in SQL with the same rule as the send: Dave opted out, Eve is outside the domains.
        mvc.perform(get("/v1/organizations/sabf/mail").with(admin()))
            .andExpect(jsonPath("$.recipientEstimate").value(1));
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

    // Deliveries go out from the org's current account: they wait while it has
    // none and resume once it reconnects, also with another address.
    @Test
    void pendingDeliveriesWaitForTheOrgsAccountAndResumeFromTheNewOne() throws Exception {
        connectedAccount("sabf@itba.edu.ar");
        long id = draft("Convocatoria");
        mvc.perform(post("/v1/organizations/sabf/announcements/" + id + "/send").with(admin()))
            .andExpect(status().isOk());
        jdbc.update("DELETE FROM public.mail_sender_account WHERE owner_ref = 'sabf'");

        sender.runPending();
        mvc.perform(get("/v1/organizations/sabf/announcements").with(admin()))
            .andExpect(jsonPath("$[0].status").value("sending"))
            .andExpect(jsonPath("$[0].pending").value(1));

        connectedAccount("prensa.sabf@itba.edu.ar");
        sender.runPending();
        mvc.perform(get("/v1/organizations/sabf/announcements").with(admin()))
            .andExpect(jsonPath("$[0].status").value("sent"))
            .andExpect(jsonPath("$[0].sent").value(1));
        assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM public.mail_send_log WHERE account = 'prensa.sabf@itba.edu.ar'",
            Integer.class)).isEqualTo(1);
    }

    @Test
    void anOrgSendsAtMostTheWeeklyLimitAndOnlyAdminsManageEmails() throws Exception {
        connectedAccount("sabf@itba.edu.ar");
        long first = draft("Primera");
        // org-mail.weekly-limit defaults to 3.
        for (String subject : new String[] {"Segunda", "Tercera"}) {
            mvc.perform(post("/v1/organizations/sabf/announcements/" + draft(subject) + "/send").with(admin()))
                .andExpect(status().isOk());
        }
        mvc.perform(post("/v1/organizations/sabf/announcements/" + first + "/send").with(admin()))
            .andExpect(status().isOk());
        long fourth = draft("Cuarta");
        mvc.perform(post("/v1/organizations/sabf/announcements/" + fourth + "/send").with(admin()))
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
