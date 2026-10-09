package org.ceitba.api.web.news;

import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.news.UserFollow;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserFollowRepository;

import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class OrganizationEndpointsIT {

    @Autowired MockMvc mvc;
    @Autowired OrganizationRepository orgRepo;
    @Autowired UserRepository userRepo;
    @Autowired UserFollowRepository followRepo;

    @BeforeEach
    void seed() {
        followRepo.deleteAll();
        userRepo.deleteAll();
        orgRepo.deleteAll();
        var it = new Organization("it", "IT", "IT Branch");
        it.setDescription("The tech branch");
        it.setCategory("tech");
        orgRepo.save(it);
        orgRepo.save(new Organization("media", "Media", "Media Branch"));
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

    // -- Public reads ----------------------------------------------------------

    @Test
    void listReturnsAllOrgs() throws Exception {
        mvc.perform(get("/v1/organizations"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(2));
    }

    @Test
    void getBySlugReturnsCorrectOrg() throws Exception {
        mvc.perform(get("/v1/organizations/it"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.slug").value("it"))
            .andExpect(jsonPath("$.name").value("IT"))
            .andExpect(jsonPath("$.fullName").value("IT Branch"))
            .andExpect(jsonPath("$.description").value("The tech branch"))
            .andExpect(jsonPath("$.category").value("tech"));
    }

    @Test
    void getByUnknownSlugReturns404() throws Exception {
        mvc.perform(get("/v1/organizations/nope"))
            .andExpect(status().isNotFound());
    }

    // -- Auth gates on writes --------------------------------------------------

    @Test
    void anonymousCannotCreate() throws Exception {
        mvc.perform(post("/v1/organizations")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"slug\":\"new\",\"name\":\"New\",\"fullName\":\"New Branch\"}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void regularUserCannotCreate() throws Exception {
        mvc.perform(post("/v1/organizations").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"slug\":\"new\",\"name\":\"New\",\"fullName\":\"New Branch\"}"))
            .andExpect(status().isForbidden());
    }

    // -- Staff CRUD ------------------------------------------------------------

    @Test
    void staffCanCreate() throws Exception {
        mvc.perform(post("/v1/organizations").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"slug\":\"nautical\",\"name\":\"Nautical\",\"fullName\":\"Nautical Branch\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.slug").value("nautical"))
            .andExpect(jsonPath("$.name").value("Nautical"));
    }

    @Test
    void duplicateSlugReturns409() throws Exception {
        mvc.perform(post("/v1/organizations").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"slug\":\"it\",\"name\":\"IT v2\",\"fullName\":\"IT Branch v2\"}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("ResourceAlreadyExists"));
    }

    @Test
    void createRejectsMalformedSlugs() throws Exception {
        for (String slug : new String[] {
                "Upper", "with space", "acentó", "-lead", "trail-", "double--hyphen",
                "under_score", "a", "x".repeat(41)}) {
            mvc.perform(post("/v1/organizations").with(staff())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"slug\":\"" + slug + "\",\"name\":\"N\",\"fullName\":\"N B\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("ValidationError"))
                // The message names the field so the SPA/staff can tell what to fix
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.startsWith("slug: ")));
        }
    }

    @Test
    void createAcceptsKebabCaseSlugAtBounds() throws Exception {
        for (String slug : new String[] {"ab", "computer-society-2", "x".repeat(40)}) {
            mvc.perform(post("/v1/organizations").with(staff())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"slug\":\"" + slug + "\",\"name\":\"N\",\"fullName\":\"N B\"}"))
                .andExpect(status().isCreated());
        }
    }

    @Test
    void staffCanPatch() throws Exception {
        mvc.perform(patch("/v1/organizations/it").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"IT Updated\",\"fullName\":\"IT Branch Updated\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("IT Updated"));
    }

    // The slug is the primary key and only comes from the path: a slug in the
    // PATCH body (even one the create pattern would reject) is ignored, so
    // existing orgs stay editable and can't be renamed through PATCH.
    @Test
    void patchIgnoresSlugInBody() throws Exception {
        mvc.perform(patch("/v1/organizations/it").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"slug\":\"Not A Slug\",\"name\":\"IT Renamed\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.slug").value("it"))
            .andExpect(jsonPath("$.name").value("IT Renamed"));

        mvc.perform(get("/v1/organizations/it"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("IT Renamed"));
    }

    @Test
    void staffCanPatchProfileFields() throws Exception {
        mvc.perform(patch("/v1/organizations/it").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"description\":\"updated\",\"logoUrl\":\"https://x/l.png\",\"backgroundUrl\":\"https://x/bg.png\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.description").value("updated"))
            .andExpect(jsonPath("$.logoUrl").value("https://x/l.png"))
            .andExpect(jsonPath("$.backgroundUrl").value("https://x/bg.png"))
            // Omitted fields are left alone, not blanked
            .andExpect(jsonPath("$.name").value("IT"))
            .andExpect(jsonPath("$.fullName").value("IT Branch"));

        mvc.perform(get("/v1/organizations/it"))
            .andExpect(jsonPath("$.name").value("IT"))
            .andExpect(jsonPath("$.fullName").value("IT Branch"));
    }

    @Test
    void followerCountIsLive() throws Exception {
        var alice = userRepo.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
        var bob   = userRepo.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));
        followRepo.save(new UserFollow(alice.getId(), "it"));
        followRepo.save(new UserFollow(bob.getId(), "it"));

        mvc.perform(get("/v1/organizations/it"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.followerCount").value(2));

        mvc.perform(get("/v1/organizations/media"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.followerCount").value(0));
    }

    @Test
    void regularUserCannotPatch() throws Exception {
        mvc.perform(patch("/v1/organizations/it").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"description\":\"x\"}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void patchUnknownSlugReturns404() throws Exception {
        mvc.perform(patch("/v1/organizations/nope").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"x\",\"fullName\":\"x\"}"))
            .andExpect(status().isNotFound());
    }

    @Test
    void staffCanDelete() throws Exception {
        mvc.perform(delete("/v1/organizations/media").with(staff()))
            .andExpect(status().isNoContent());
        mvc.perform(get("/v1/organizations/media"))
            .andExpect(status().isNotFound());
    }

    @Test
    void deleteUnknownReturns404() throws Exception {
        mvc.perform(delete("/v1/organizations/nope").with(staff()))
            .andExpect(status().isNotFound());
    }
}
