package org.ceitba.api.web.news;

import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.domain.news.UserOrganizationId;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.OrgInviteRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Org self-service (docs/ORGANIZATIONS.md): member management by the org's
// admins, the last-admin guard, invites claimed at first login, members
// deleting their org's content and signing org image uploads.
@SpringBootTest
@AutoConfigureMockMvc
class OrgMembersEndpointsIT {

    @Autowired MockMvc mvc;
    @Autowired UserRepository userRepo;
    @Autowired OrganizationRepository orgRepo;
    @Autowired UserOrganizationRepository membershipRepo;
    @Autowired OrgInviteRepository inviteRepo;
    @Autowired ArticleRepository articleRepo;
    @Autowired NewsEventRepository eventRepo;

    UUID aliceId;   // sabf member
    UUID bobId;     // no org
    UUID carolId;   // sabf admin

    @BeforeEach
    void seed() {
        articleRepo.deleteAll();
        eventRepo.deleteAll();
        inviteRepo.deleteAll();
        membershipRepo.deleteAll();
        userRepo.deleteAll();
        orgRepo.deleteAll();

        orgRepo.save(new Organization("ceitba", "CEITBA", "Centro de Estudiantes"));
        orgRepo.save(new Organization("sabf", "SABF", "South American Business Forum"));
        orgRepo.save(new Organization("trama", "TRAMA", "TRAMA ITBA"));

        aliceId = userRepo.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice")).getId();
        bobId = userRepo.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob")).getId();
        carolId = userRepo.save(new User(UUID.randomUUID(), "carol@itba.edu.ar", "Carol")).getId();
        membershipRepo.save(new UserOrganization(aliceId, "sabf", "member"));
        membershipRepo.save(new UserOrganization(carolId, "sabf", "admin"));

        for (var org : List.of("sabf", "trama")) {
            var a = new Article(org + "-art", org + " news", "x", List.of("p"), "news", List.of(org));
            a.setOrganization(orgRepo.findById(org).orElseThrow());
            articleRepo.save(a);
            var e = new NewsEvent(org + "-evt", org + " meetup", LocalDate.of(2026, 6, 1),
                LocalTime.of(18, 0), LocalTime.of(20, 0), "Aula 1", "meetup");
            e.setOrganization(orgRepo.findById(org).orElseThrow());
            eventRepo.save(e);
        }
    }

    private static RequestPostProcessor as(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", email))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static RequestPostProcessor orgAdmin() { return as("carol@itba.edu.ar"); }
    private static RequestPostProcessor member()   { return as("alice@itba.edu.ar"); }
    private static RequestPostProcessor outsider() { return as("bob@itba.edu.ar"); }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar").claim("name", "Boss"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    private String role(UUID userId, String org) {
        return membershipRepo.findById(new UserOrganizationId(userId, org)).map(UserOrganization::getRole).orElse(null);
    }

    // ---- listing ----

    @Test
    void adminListsMembersWithEmails() throws Exception {
        mvc.perform(get("/v1/organizations/sabf/members").with(orgAdmin()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.members.length()").value(2))
            .andExpect(jsonPath("$.members[0].email").value("carol@itba.edu.ar"))
            .andExpect(jsonPath("$.members[0].role").value("admin"))
            .andExpect(jsonPath("$.invites.length()").value(0));
    }

    @Test
    void plainMemberAndOutsiderCannotListMembers() throws Exception {
        mvc.perform(get("/v1/organizations/sabf/members").with(member())).andExpect(status().isForbidden());
        mvc.perform(get("/v1/organizations/sabf/members").with(outsider())).andExpect(status().isForbidden());
        mvc.perform(get("/v1/organizations/sabf/members")).andExpect(status().isForbidden());
    }

    @Test
    void adminOfAnotherOrgCannotManageThisOne() throws Exception {
        membershipRepo.save(new UserOrganization(bobId, "trama", "admin"));
        mvc.perform(get("/v1/organizations/sabf/members").with(outsider())).andExpect(status().isForbidden());
    }

    // ---- invites ----

    @Test
    void inviteAddsExistingUsersAndKeepsUnknownEmailsPending() throws Exception {
        mvc.perform(post("/v1/organizations/sabf/members/invites").with(orgAdmin())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"emails\":[\"Bob@itba.edu.ar\",\"dave@itba.edu.ar\"],\"role\":\"member\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.added.length()").value(1))
            .andExpect(jsonPath("$.added[0].email").value("bob@itba.edu.ar"))
            .andExpect(jsonPath("$.pending.length()").value(1))
            .andExpect(jsonPath("$.pending[0].email").value("dave@itba.edu.ar"));

        assertThat(role(bobId, "sabf")).isEqualTo("member");
        assertThat(membershipRepo.findById(new UserOrganizationId(bobId, "sabf")).orElseThrow().getAddedBy())
            .isEqualTo(carolId);
        assertThat(inviteRepo.findByOrganizationOrderByEmail("sabf")).hasSize(1);
    }

    @Test
    void inviteRefusesEmailsOutsideTheLoginAllowlist() throws Exception {
        mvc.perform(post("/v1/organizations/sabf/members/invites").with(orgAdmin())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"emails\":[\"someone@gmail.com\"]}"))
            .andExpect(status().isBadRequest());
        assertThat(inviteRepo.count()).isZero();
    }

    @Test
    void memberCannotInvite() throws Exception {
        mvc.perform(post("/v1/organizations/sabf/members/invites").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"emails\":[\"bob@itba.edu.ar\"]}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void pendingInviteBecomesMembershipOnFirstLogin() throws Exception {
        mvc.perform(post("/v1/organizations/sabf/members/invites").with(orgAdmin())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"emails\":[\"dave@itba.edu.ar\"],\"role\":\"admin\"}"))
            .andExpect(status().isOk());

        // First @CurrentUser request of the new email provisions it.
        mvc.perform(get("/v1/me/organizations").with(as("dave@itba.edu.ar")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].slug").value("sabf"))
            .andExpect(jsonPath("$[0].role").value("admin"));

        assertThat(inviteRepo.count()).isZero();
    }

    @Test
    void pendingInviteIsClaimedWhenStaffCreatesTheUser() throws Exception {
        mvc.perform(post("/v1/organizations/sabf/members/invites").with(orgAdmin())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"emails\":[\"dave@itba.edu.ar\"]}"))
            .andExpect(status().isOk());

        mvc.perform(post("/v1/users/create").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"dave@itba.edu.ar\",\"name\":\"Dave\"}"))
            .andExpect(status().isCreated());

        var dave = userRepo.findByEmail("dave@itba.edu.ar").orElseThrow();
        assertThat(role(dave.getId(), "sabf")).isEqualTo("member");
        assertThat(inviteRepo.count()).isZero();
    }

    @Test
    void adminRevokesPendingInvite() throws Exception {
        mvc.perform(post("/v1/organizations/sabf/members/invites").with(orgAdmin())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"emails\":[\"dave@itba.edu.ar\"]}"))
            .andExpect(status().isOk());

        mvc.perform(delete("/v1/organizations/sabf/members/invites").param("email", "dave@itba.edu.ar")
                .with(orgAdmin()))
            .andExpect(status().isNoContent());
        assertThat(inviteRepo.count()).isZero();
    }

    // ---- roles, board, removal, last-admin guard ----

    @Test
    void adminSetsBoardTitleShownOnThePortal() throws Exception {
        mvc.perform(patch("/v1/organizations/sabf/members/" + aliceId).with(orgAdmin())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Presidenta\",\"showOnPortal\":true}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Presidenta"))
            .andExpect(jsonPath("$.showOnPortal").value(true));

        mvc.perform(get("/v1/organizations/sabf"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.board.length()").value(1))
            .andExpect(jsonPath("$.board[0].name").value("Alice"))
            .andExpect(jsonPath("$.board[0].title").value("Presidenta"))
            .andExpect(jsonPath("$.board[0].email").doesNotExist());
    }

    @Test
    void adminCannotDemoteOrRemoveThemselvesWhenLastAdmin() throws Exception {
        mvc.perform(patch("/v1/organizations/sabf/members/" + carolId).with(orgAdmin())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"role\":\"member\"}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("LastOrgAdmin"));

        mvc.perform(delete("/v1/organizations/sabf/members/me").with(orgAdmin()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("LastOrgAdmin"));

        assertThat(role(carolId, "sabf")).isEqualTo("admin");

        // STAFF is the escape hatch: no guard.
        mvc.perform(delete("/v1/organizations/sabf/members/" + carolId).with(staff()))
            .andExpect(status().isNoContent());
        assertThat(role(carolId, "sabf")).isNull();
    }

    @Test
    void transferAdminHandsOverAndStepsDown() throws Exception {
        mvc.perform(post("/v1/organizations/sabf/members/" + aliceId + "/transfer-admin").with(orgAdmin()))
            .andExpect(status().isNoContent());

        assertThat(role(aliceId, "sabf")).isEqualTo("admin");
        assertThat(role(carolId, "sabf")).isEqualTo("member");

        // Carol is a plain member now.
        mvc.perform(get("/v1/organizations/sabf/members").with(orgAdmin())).andExpect(status().isForbidden());
    }

    @Test
    void adminRemovesMemberAndMemberCanLeave() throws Exception {
        mvc.perform(delete("/v1/organizations/sabf/members/" + aliceId).with(orgAdmin()))
            .andExpect(status().isNoContent());
        assertThat(role(aliceId, "sabf")).isNull();

        membershipRepo.save(new UserOrganization(bobId, "sabf", "member"));
        mvc.perform(delete("/v1/organizations/sabf/members/me").with(outsider()))
            .andExpect(status().isNoContent());
        assertThat(role(bobId, "sabf")).isNull();
    }

    @Test
    void lastOrgAdminCannotDeleteTheirAccount() throws Exception {
        mvc.perform(delete("/v1/me").with(orgAdmin()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("LastOrgAdmin"));
        assertThat(userRepo.findById(carolId)).isPresent();
    }

    // ---- content and uploads ----

    @Test
    void memberDeletesOwnOrgsEventAndArticleButNotAnotherOrgs() throws Exception {
        mvc.perform(delete("/v1/news/events/sabf-evt").with(member())).andExpect(status().isNoContent());
        mvc.perform(delete("/v1/articles/sabf-art").with(member())).andExpect(status().isNoContent());
        mvc.perform(delete("/v1/news/events/trama-evt").with(member())).andExpect(status().isForbidden());
        mvc.perform(delete("/v1/articles/trama-art").with(member())).andExpect(status().isForbidden());

        assertThat(eventRepo.existsById("sabf-evt")).isFalse();
        assertThat(articleRepo.existsById("sabf-art")).isFalse();
        assertThat(eventRepo.existsById("trama-evt")).isTrue();
        assertThat(articleRepo.existsById("trama-art")).isTrue();
    }

    @Test
    void orgImageUploadIsForMembersOnly() throws Exception {
        var body = "{\"filename\":\"logo.png\",\"contentType\":\"image/png\",\"sizeBytes\":1024}";
        mvc.perform(post("/v1/organizations/sabf/media/sign-upload").with(outsider())
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isForbidden());
        // Authorized; storage is not configured in tests.
        mvc.perform(post("/v1/organizations/sabf/media/sign-upload").with(member())
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isNotImplemented());
    }

    @Test
    void memberUpdatesContactAndRecruitingFields() throws Exception {
        mvc.perform(patch("/v1/organizations/sabf").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"instagram":"https://www.instagram.com/SABF.ok/","websiteUrl":"https://sabf.org.ar",
                     "contactEmail":"sabf@itba.edu.ar","recruitingOpen":true,"recruitingText":"Sumate"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.instagram").value("sabf.ok"))
            .andExpect(jsonPath("$.recruitingOpen").value(true));

        mvc.perform(patch("/v1/organizations/sabf").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"websiteUrl\":\"javascript:alert(1)\"}"))
            .andExpect(status().isBadRequest());
    }
}
