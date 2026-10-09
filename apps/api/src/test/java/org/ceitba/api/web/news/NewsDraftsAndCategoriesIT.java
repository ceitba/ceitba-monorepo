package org.ceitba.api.web.news;

import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
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

import java.util.List;
import java.util.UUID;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Draft visibility (staff status=all, org members' own drafts), canonical
// categories, and http(s)-only organization image URLs.
@SpringBootTest
@AutoConfigureMockMvc
class NewsDraftsAndCategoriesIT {

    @Autowired MockMvc mvc;
    @Autowired UserRepository userRepo;
    @Autowired OrganizationRepository orgRepo;
    @Autowired UserOrganizationRepository membershipRepo;
    @Autowired ArticleRepository articleRepo;
    @Autowired NewsEventRepository eventRepo;

    @BeforeEach
    void seed() {
        articleRepo.deleteAll();
        eventRepo.deleteAll();
        membershipRepo.deleteAll();
        userRepo.deleteAll();
        orgRepo.deleteAll();

        orgRepo.save(new Organization("sabf", "SABF", "South American Business Forum"));
        orgRepo.save(new Organization("trama", "TRAMA", "TRAMA ITBA"));

        var alice = userRepo.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
        membershipRepo.save(new UserOrganization(alice.getId(), "sabf", "member"));
        userRepo.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));

        article("sabf-pub",   "sabf",  "published", "Académico");
        article("sabf-draft", "sabf",  "draft",     "Académico");
        article("trama-pub",  "trama", "published", "Cultura");
        article("trama-draft","trama", "draft",     "Cultura");
        article("legacy",     null,    "published", "ACADÉMICO");
    }

    private void article(String id, String org, String status, String category) {
        var a = new Article(id, id, "x", List.of("p"), category, List.of("A"));
        a.setStatus(status);
        if (org != null) a.setOrganization(orgRepo.findById(org).orElseThrow());
        articleRepo.save(a);
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar").claim("name", "Boss"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    private static RequestPostProcessor member() {
        return jwt().jwt(t -> t.claim("email", "alice@itba.edu.ar").claim("name", "Alice"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static RequestPostProcessor outsider() {
        return jwt().jwt(t -> t.claim("email", "bob@itba.edu.ar").claim("name", "Bob"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    // -- Staff: status=all -----------------------------------------------------

    @Test
    void staffStatusAllListsDraftsAndPublished() throws Exception {
        mvc.perform(get("/v1/articles?status=all&limit=100").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.meta.total").value(5))
            .andExpect(jsonPath("$.data[*].id").value(containsInAnyOrder(
                "sabf-pub", "sabf-draft", "trama-pub", "trama-draft", "legacy")));
    }

    @Test
    void staffWithoutStatusStillGetsPublishedOnly() throws Exception {
        mvc.perform(get("/v1/articles").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.meta.total").value(3));
    }

    // -- Non-staff -------------------------------------------------------------

    @Test
    void anonymousStatusAllOrDraftGetsPublishedOnly() throws Exception {
        for (String s : List.of("all", "draft")) {
            mvc.perform(get("/v1/articles?status=" + s))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(3))
                .andExpect(jsonPath("$.data[*].id").value(containsInAnyOrder("sabf-pub", "trama-pub", "legacy")));
        }
        mvc.perform(get("/v1/articles?organization=sabf&status=all"))
            .andExpect(jsonPath("$.data[*].id").value(containsInAnyOrder("sabf-pub")));
    }

    @Test
    void outsiderStatusAllGetsPublishedOnly() throws Exception {
        mvc.perform(get("/v1/articles?status=all").with(outsider()))
            .andExpect(jsonPath("$.meta.total").value(3));
        mvc.perform(get("/v1/articles?organization=sabf&status=all").with(outsider()))
            .andExpect(jsonPath("$.data[*].id").value(containsInAnyOrder("sabf-pub")));
    }

    // -- Org members -----------------------------------------------------------

    @Test
    void memberListsOwnOrgDrafts() throws Exception {
        mvc.perform(get("/v1/articles?organization=sabf&status=all").with(member()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[*].id").value(containsInAnyOrder("sabf-pub", "sabf-draft")));
        mvc.perform(get("/v1/articles?organization=sabf&status=draft").with(member()))
            .andExpect(jsonPath("$.data[*].id").value(containsInAnyOrder("sabf-draft")));
        // No status still means published, for members too.
        mvc.perform(get("/v1/articles?organization=sabf").with(member()))
            .andExpect(jsonPath("$.data[*].id").value(containsInAnyOrder("sabf-pub")));
    }

    @Test
    void memberDoesNotSeeOtherOrgDrafts() throws Exception {
        mvc.perform(get("/v1/articles?organization=trama&status=all").with(member()))
            .andExpect(jsonPath("$.data[*].id").value(containsInAnyOrder("trama-pub")));
        // Without an organization filter the member is a plain reader.
        mvc.perform(get("/v1/articles?status=all").with(member()))
            .andExpect(jsonPath("$.meta.total").value(3));
    }

    @Test
    void memberGetsOwnOrgDraftById() throws Exception {
        mvc.perform(get("/v1/articles/sabf-draft").with(member()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("draft"));
    }

    @Test
    void draftByIdIsHiddenFromEveryoneElse() throws Exception {
        mvc.perform(get("/v1/articles/trama-draft").with(member())).andExpect(status().isNotFound());
        mvc.perform(get("/v1/articles/sabf-draft").with(outsider())).andExpect(status().isNotFound());
        mvc.perform(get("/v1/articles/sabf-draft")).andExpect(status().isNotFound());
        mvc.perform(get("/v1/articles/sabf-draft").with(staff())).andExpect(status().isOk());
    }

    // -- Canonical categories --------------------------------------------------

    @Test
    void createWithNonCanonicalCategoryIs400() throws Exception {
        for (String c : List.of("ACADÉMICO", "academico", "Todos", "")) {
            mvc.perform(post("/v1/articles").with(staff())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {"title":"T","excerpt":"E","body":[],"category":"%s","authors":["A"]}
                        """.formatted(c)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(containsString("category")));
        }
        mvc.perform(post("/v1/news/events").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"T","eventDate":"2026-08-01","startTime":"10:00","endTime":"12:00",
                     "location":"L","category":"DEPORTES"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value(containsString("must be one of")));
    }

    @Test
    void createWithCanonicalCategorySucceeds() throws Exception {
        mvc.perform(post("/v1/articles").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"T\",\"excerpt\":\"E\",\"body\":[],\"category\":\"Tecnología\",\"authors\":[\"A\"]}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.category").value("Tecnología"));
    }

    @Test
    void patchWithNonCanonicalCategoryIs400() throws Exception {
        mvc.perform(patch("/v1/articles/sabf-pub").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"category\":\"DEPORTES\"}"))
            .andExpect(status().isBadRequest());
        mvc.perform(patch("/v1/articles/sabf-pub").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"category\":\"Deportes\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.category").value("Deportes"));
    }

    @Test
    void categoryFilterIsExact() throws Exception {
        mvc.perform(get("/v1/articles?category=Académico"))
            .andExpect(jsonPath("$.data[*].id").value(containsInAnyOrder("sabf-pub")));
        mvc.perform(get("/v1/articles?category=academico"))
            .andExpect(jsonPath("$.meta.total").value(0));
    }

    // -- Organization image URLs -----------------------------------------------

    @Test
    void organizationUrlsMustBeHttp() throws Exception {
        mvc.perform(post("/v1/organizations").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"slug":"x","name":"X","fullName":"X Org","logoUrl":"javascript:alert(1)"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value(containsString("logoUrl")));

        mvc.perform(patch("/v1/organizations/sabf").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"backgroundUrl\":\"javascript:alert(1)\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value(containsString("backgroundUrl")));

        mvc.perform(patch("/v1/organizations/sabf").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"logoUrl\":\"https://x.test/" + "a".repeat(2048) + "\"}"))
            .andExpect(status().isBadRequest());

        mvc.perform(patch("/v1/organizations/sabf").with(member())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"logoUrl\":\"https://x.test/l.png\",\"backgroundUrl\":\"\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.logoUrl").value("https://x.test/l.png"));
    }
}
