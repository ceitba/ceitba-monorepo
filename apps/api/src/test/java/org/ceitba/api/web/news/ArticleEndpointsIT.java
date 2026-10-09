package org.ceitba.api.web.news;

import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.service.auth.ApiKeyService;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.junit.jupiter.api.BeforeEach;
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
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import com.jayway.jsonpath.JsonPath;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.util.ArrayList;
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

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class ArticleEndpointsIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired ArticleRepository articleRepo;
    @Autowired OrganizationRepository orgRepo;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired ApiKeyService apiKeys;

    @BeforeEach
    void seed() {
        articleRepo.deleteAll();
        orgRepo.deleteAll();

        orgRepo.save(new Organization("it", "IT", "IT Branch"));

        var pub = new Article("a1", "Published", "excerpt", List.of("para1"), "tech", List.of("Author"));
        pub.setStatus("published");
        articleRepo.save(pub);

        var draft = new Article("a2", "Draft Article", "excerpt", List.of("draft para"), "tech", List.of("Author"));
        draft.setStatus("draft");
        articleRepo.save(draft);
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar").claim("name", "Boss"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"),
                         new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    private static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "user@itba.edu.ar").claim("name", "User"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    // -- Public list -----------------------------------------------------------

    @Test
    void publicListShowsOnlyPublished() throws Exception {
        mvc.perform(get("/v1/articles"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].id").value("a1"))
            .andExpect(jsonPath("$.meta.total").value(1));
    }

    // Offset pagination over rows that tie on created_at used to be able to
    // repeat or skip rows across pages (ORDER BY created_at only). With `id`
    // as tie-break the pages partition the list in a fixed order.
    @Test
    void paginationIsStrictWhenCreatedAtTies() throws Exception {
        for (int i = 0; i < 9; i++) {
            var a = new Article("t" + i, "Tied " + i, "excerpt", List.of("p"), "tech", List.of("Author"));
            a.setStatus("published");
            articleRepo.save(a);
        }
        jdbc.update("UPDATE public.articles SET created_at = TIMESTAMPTZ '2026-01-01 12:00:00+00'");

        var seen = new ArrayList<String>();
        for (int page = 1; page <= 4; page++) {
            String body = mvc.perform(get("/v1/articles?limit=3&page=" + page))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
            List<String> ids = JsonPath.read(body, "$.data[*].id");
            seen.addAll(ids);
        }
        assertThat(seen).containsExactly("t8", "t7", "t6", "t5", "t4", "t3", "t2", "t1", "t0", "a1");
    }

    @Test
    void listClampsLimit() throws Exception {
        // limit=0 used to reach PageRequest.of and 500
        mvc.perform(get("/v1/articles?limit=0"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.meta.limit").value(1));

        mvc.perform(get("/v1/articles?limit=1000000"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.meta.limit").value(100))
            .andExpect(jsonPath("$.meta.page").value(1));
    }

    @Test
    void staffListCanSeeDrafts() throws Exception {
        mvc.perform(get("/v1/articles?status=draft").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].id").value("a2"));
    }

    @Test
    void staffListWithNullStatusDefaultsToPublished() throws Exception {
        mvc.perform(get("/v1/articles").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1));
    }

    @Test
    void publicListIgnoresDraftStatusParam() throws Exception {
        // Even if an anonymous caller passes status=draft, they only get published
        mvc.perform(get("/v1/articles?status=draft"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].status").value("published"));
    }

    @Test
    void filterByCategoryReturnsMatchingOnly() throws Exception {
        var other = new Article("a3", "Other", "e", List.of(), "events", List.of("A"));
        other.setStatus("published");
        articleRepo.save(other);

        mvc.perform(get("/v1/articles?category=tech"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].category").value("tech"));
    }

    @Test
    void paginationMetaIsCorrect() throws Exception {
        mvc.perform(get("/v1/articles?page=1&limit=1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.meta.total").value(1))
            .andExpect(jsonPath("$.meta.page").value(1))
            .andExpect(jsonPath("$.meta.limit").value(1));
    }

    // -- Get one ---------------------------------------------------------------

    @Test
    void getPublishedArticleById() throws Exception {
        mvc.perform(get("/v1/articles/a1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("a1"))
            .andExpect(jsonPath("$.title").value("Published"))
            .andExpect(jsonPath("$.body[0]").value("para1"));
    }

    @Test
    void getDraftReturns404ForAnonymous() throws Exception {
        mvc.perform(get("/v1/articles/a2"))
            .andExpect(status().isNotFound());
    }

    @Test
    void staffCanGetDraftById() throws Exception {
        mvc.perform(get("/v1/articles/a2").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("a2"))
            .andExpect(jsonPath("$.status").value("draft"));
    }

    @Test
    void unknownIdReturns404() throws Exception {
        mvc.perform(get("/v1/articles/nope"))
            .andExpect(status().isNotFound());
    }

    // -- Auth gates on writes --------------------------------------------------

    @Test
    void anonymousCannotCreate() throws Exception {
        mvc.perform(post("/v1/articles")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"T\",\"excerpt\":\"E\",\"body\":[],\"category\":\"Tecnología\",\"authors\":[\"A\"]}"))
            .andExpect(status().isUnauthorized());
    }

    // -- Independent (org-less) articles by plain users -------------------------

    private static RequestPostProcessor otherUser() {
        return jwt().jwt(t -> t.claim("email", "other@itba.edu.ar").claim("name", "Other"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static final String INDEPENDENT =
        "{\"id\":\"ind\",\"title\":\"T\",\"excerpt\":\"E\",\"body\":[],\"category\":\"Tecnología\",\"authors\":[\"A\"]%s}";

    // Returns the generated id: a non-staff author's "id" is ignored.
    private String createIndependent() throws Exception {
        return createIndependent(user());
    }

    private String createIndependent(RequestPostProcessor as) throws Exception {
        String json = mvc.perform(post("/v1/articles").with(as)
                .contentType(MediaType.APPLICATION_JSON)
                .content(INDEPENDENT.formatted("")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value("pending_review"))
            .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(json, "$.id");
        assertThat(id).isNotEqualTo("ind");
        return id;
    }

    @Test
    void apiKeyUserManagesOwnIndependentArticle() throws Exception {
        User keyUser = users.findByEmail("keyuser@itba.edu.ar")
            .orElseGet(() -> users.save(new User(UUID.randomUUID(), "keyuser@itba.edu.ar", "Key User")));
        String key = apiKeys.create(keyUser, "script", 1).key();
        RequestPostProcessor viaKey = r -> { r.addHeader("X-Api-Key", key); return r; };

        String id = createIndependent(viaKey);
        mvc.perform(get("/v1/articles/" + id).with(viaKey))
            .andExpect(status().isOk());
        mvc.perform(get("/v1/articles?mine=true").with(viaKey))
            .andExpect(jsonPath("$.data.length()").value(1));
        mvc.perform(patch("/v1/articles/" + id).with(viaKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Edited\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Edited"))
            // Omitting status keeps it (Article's "published" default must not leak).
            .andExpect(jsonPath("$.status").value("pending_review"));
        mvc.perform(delete("/v1/articles/" + id).with(viaKey))
            .andExpect(status().isNoContent());
    }

    @Test
    void staffSuppliedIdMustBeASlug() throws Exception {
        mvc.perform(post("/v1/articles").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content(INDEPENDENT.formatted("").replace("\"ind\"", "\"Bad Id!\"")))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/articles").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content(INDEPENDENT.formatted("")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value("ind"));
    }

    @Test
    void regularUserCannotCreatePublishedIndependentArticle() throws Exception {
        mvc.perform(post("/v1/articles").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content(INDEPENDENT.formatted(",\"status\":\"published\"")))
            .andExpect(status().isBadRequest());
    }

    @Test
    void regularUserCannotCreateForOrgTheyDontBelongTo() throws Exception {
        mvc.perform(post("/v1/articles").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content(INDEPENDENT.formatted(",\"organization\":\"it\"")))
            .andExpect(status().isForbidden());
    }

    @Test
    void authorEditsOwnPendingArticleUntilStaffPublishIt() throws Exception {
        String ind = createIndependent();

        // Author reads and edits it, but can't publish it.
        mvc.perform(get("/v1/articles/" + ind).with(user()))
            .andExpect(status().isOk());
        mvc.perform(patch("/v1/articles/" + ind).with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Edited\",\"status\":\"draft\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("draft"));
        mvc.perform(patch("/v1/articles/" + ind).with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"published\"}"))
            .andExpect(status().isBadRequest());
        // Nor move it into an org they don't belong to.
        mvc.perform(patch("/v1/articles/" + ind).with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"organization\":\"it\"}"))
            .andExpect(status().isForbidden());

        // Other users neither see nor edit it.
        mvc.perform(get("/v1/articles/" + ind).with(otherUser()))
            .andExpect(status().isNotFound());
        mvc.perform(patch("/v1/articles/" + ind).with(otherUser())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Hijacked\"}"))
            .andExpect(status().isForbidden());
        mvc.perform(delete("/v1/articles/" + ind).with(otherUser()))
            .andExpect(status().isForbidden());

        // Staff publish it; from then on the author can't edit or delete it.
        mvc.perform(patch("/v1/articles/" + ind).with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"published\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("published"));
        mvc.perform(patch("/v1/articles/" + ind).with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Too late\"}"))
            .andExpect(status().isForbidden());
        mvc.perform(delete("/v1/articles/" + ind).with(user()))
            .andExpect(status().isForbidden());
    }

    @Test
    void undoingAPublishCanClearTheDateItFilledIn() throws Exception {
        String ind = createIndependent();
        mvc.perform(patch("/v1/articles/" + ind).with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"published\",\"publishedAt\":\"2026-10-07\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.publishedAt").value("2026-10-07"));

        // A null date means "unchanged"...
        mvc.perform(patch("/v1/articles/" + ind).with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"pending_review\",\"publishedAt\":null}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.publishedAt").value("2026-10-07"));
        // ...so emptying it takes the explicit flag.
        mvc.perform(patch("/v1/articles/" + ind).with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"pending_review\",\"clearPublishedAt\":true}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("pending_review"));
        assertThat(articleRepo.findById(ind).orElseThrow().getPublishedAt()).isNull();
    }

    @Test
    void expectedStatusRefusesAPublishFromAStaleReviewRow() throws Exception {
        String ind = createIndependent();
        // The author pulls it back to draft after the review queue loaded it.
        mvc.perform(patch("/v1/articles/" + ind).with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"draft\"}"))
            .andExpect(status().isOk());

        mvc.perform(patch("/v1/articles/" + ind).with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"published\",\"expectedStatus\":\"pending_review\"}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("InvalidState"));
        assertThat(articleRepo.findById(ind).orElseThrow().getStatus()).isEqualTo("draft");

        mvc.perform(patch("/v1/articles/" + ind).with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"published\",\"expectedStatus\":\"draft\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("published"));
    }

    @Test
    void publishingAnUndatedArticleDatesItToday() throws Exception {
        String ind = createIndependent();
        assertThat(articleRepo.findById(ind).orElseThrow().getPublishedAt()).isNull();

        mvc.perform(patch("/v1/articles/" + ind).with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"published\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.publishedAt").value(LocalDate.now(ClockConfig.ZONE).toString()));
    }

    @Test
    void creatingAnUndatedPublishedArticleDatesItToday() throws Exception {
        mvc.perform(post("/v1/articles").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content(INDEPENDENT.formatted(",\"status\":\"published\"")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value("published"))
            .andExpect(jsonPath("$.publishedAt").value(LocalDate.now(ClockConfig.ZONE).toString()));
    }

    @Test
    void authorCanDeleteOwnPendingArticle() throws Exception {
        String ind = createIndependent();
        mvc.perform(delete("/v1/articles/" + ind).with(user()))
            .andExpect(status().isNoContent());
    }

    @Test
    void mineListsOwnArticlesOfEveryStatus() throws Exception {
        String ind = createIndependent();
        // An org article the user wrote (e.g. before leaving the org) is not
        // part of ?mine, even when ?organization names the org.
        var orgArticle = new Article("org-art", "Org", "E", List.of(), "tech", List.of("A"));
        orgArticle.setStatus("draft");
        orgArticle.setOrganization(orgRepo.findById("it").orElseThrow());
        orgArticle.setCreatedBy(users.findByEmail("user@itba.edu.ar").orElseThrow());
        articleRepo.save(orgArticle);
        // ...nor readable by them through the author shortcut.
        mvc.perform(get("/v1/articles/org-art").with(user()))
            .andExpect(status().isNotFound());

        mvc.perform(get("/v1/articles?mine=true").with(user()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].id").value(ind))
            .andExpect(jsonPath("$.data[0].status").value("pending_review"));
        mvc.perform(get("/v1/articles?mine=true&organization=it").with(user()))
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].id").value(ind));
        mvc.perform(get("/v1/articles?mine=true&status=draft").with(user()))
            .andExpect(jsonPath("$.data.length()").value(0));
        mvc.perform(get("/v1/articles?mine=true").with(staff()))
            .andExpect(jsonPath("$.data.length()").value(0));
        mvc.perform(get("/v1/articles?mine=true"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(0));
        // The public list doesn't show it.
        mvc.perform(get("/v1/articles"))
            .andExpect(jsonPath("$.data.length()").value(1));
    }

    // -- Staff CRUD ------------------------------------------------------------

    @Test
    void staffCanCreateArticle() throws Exception {
        mvc.perform(post("/v1/articles").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"New Article","excerpt":"Ex","body":["p1","p2"],
                     "category":"Tecnología","authors":["Staff","Co-author"],
                     "status":"published","colorScheme":"blue"}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.title").value("New Article"))
            .andExpect(jsonPath("$.body.length()").value(2))
            .andExpect(jsonPath("$.body[0]").value("p1"))
            .andExpect(jsonPath("$.status").value("published"));
    }

    @Test
    void staffCanCreateDraft() throws Exception {
        mvc.perform(post("/v1/articles").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Draft\",\"excerpt\":\"E\",\"body\":[],\"category\":\"Tecnología\",\"authors\":[\"A\"],\"status\":\"draft\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value("draft"));
    }

    @Test
    void staffCanPatchTitle() throws Exception {
        mvc.perform(patch("/v1/articles/a1").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Updated Title\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Updated Title"))
            .andExpect(jsonPath("$.excerpt").value("excerpt")); // unchanged
    }

    @Test
    void patchWithoutFeaturedKeepsItFeatured() throws Exception {
        var a = articleRepo.findById("a1").orElseThrow();
        a.setFeatured(true);
        articleRepo.save(a);

        mvc.perform(patch("/v1/articles/a1").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Retitled\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.featured").value(true));

        mvc.perform(patch("/v1/articles/a1").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"featured\":false}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.featured").value(false));
    }

    @Test
    void staffCanPromoteDraftToPublished() throws Exception {
        mvc.perform(patch("/v1/articles/a2").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"published\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("published"));

        // Now publicly visible
        mvc.perform(get("/v1/articles/a2"))
            .andExpect(status().isOk());
    }

    @Test
    void patchUnknownIdReturns404() throws Exception {
        mvc.perform(patch("/v1/articles/nope").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"x\"}"))
            .andExpect(status().isNotFound());
    }

    @Test
    void staffCanDelete() throws Exception {
        mvc.perform(delete("/v1/articles/a1").with(staff()))
            .andExpect(status().isNoContent());
        mvc.perform(get("/v1/articles/a1"))
            .andExpect(status().isNotFound());
    }

    @Test
    void deleteUnknownReturns404() throws Exception {
        mvc.perform(delete("/v1/articles/nope").with(staff()))
            .andExpect(status().isNotFound());
    }

    @Test
    void createValidationFailsOnMissingTitle() throws Exception {
        mvc.perform(post("/v1/articles").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"\",\"excerpt\":\"E\",\"body\":[],\"category\":\"Tecnología\",\"authors\":[\"A\"]}"))
            .andExpect(status().isBadRequest());
    }
}
