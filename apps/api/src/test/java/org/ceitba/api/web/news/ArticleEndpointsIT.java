package org.ceitba.api.web.news;

import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.repository.news.ArticleRepository;
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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class ArticleEndpointsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired ArticleRepository articleRepo;
    @Autowired OrganizationRepository orgRepo;

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

    @Test
    void regularUserCannotCreate() throws Exception {
        mvc.perform(post("/v1/articles").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"T\",\"excerpt\":\"E\",\"body\":[],\"category\":\"Tecnología\",\"authors\":[\"A\"]}"))
            .andExpect(status().isForbidden());
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
