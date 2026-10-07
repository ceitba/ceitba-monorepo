package org.ceitba.api.web.user;

import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class UserEndpointsIT {

    @Autowired MockMvc mvc;
    @Autowired UserRepository userRepository;
    @Autowired CareerRepository careerRepository;
    @Autowired OrganizationRepository organizationRepository;
    @Autowired UserOrganizationRepository userOrganizationRepository;

    @BeforeEach
    void seed() {
        userOrganizationRepository.deleteAll();
        organizationRepository.deleteAll();
        userRepository.deleteAll();
        careerRepository.deleteAll();
        careerRepository.save(new Career("S", "Sistemas"));
    }

    private static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "regular@itba.edu.ar")).authorities(
            new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_USER"));
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar")).authorities(
            new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_USER"),
            new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_STAFF"));
    }

    // ----- auth gating -----

    @Test
    void anonymousCreateReturns401() throws Exception {
        mvc.perform(post("/v1/users/create")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"alice@itba.edu.ar\",\"name\":\"Alice\"}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void anonymousListReturns401() throws Exception {
        mvc.perform(get("/v1/users")).andExpect(status().isUnauthorized());
    }

    @Test
    void regularUserCreateReturns403() throws Exception {
        mvc.perform(post("/v1/users/create").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"alice@itba.edu.ar\",\"name\":\"Alice\"}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void regularUserListReturns403() throws Exception {
        mvc.perform(get("/v1/users").with(user()))
            .andExpect(status().isForbidden());
    }

    @Test
    void regularUserGetByIdReturns403() throws Exception {
        var id = java.util.UUID.randomUUID();
        mvc.perform(get("/v1/users/" + id).with(user()))
            .andExpect(status().isForbidden());
    }

    // ----- STAFF happy path -----

    @Test
    void staffCanCreateUserReturns201WithBody() throws Exception {
        mvc.perform(post("/v1/users/create").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"alice@itba.edu.ar\",\"name\":\"Alice\",\"file_number\":12345,\"career_id\":\"S\",\"plan\":\"S10-Rev23\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").exists())
            .andExpect(jsonPath("$.email").value("alice@itba.edu.ar"))
            .andExpect(jsonPath("$.name").value("Alice"))
            .andExpect(jsonPath("$.file_number").value(12345))
            .andExpect(jsonPath("$.career_id").value("S"));
    }

    @Test
    void staffCreateWithUnknownCareerReturns404() throws Exception {
        mvc.perform(post("/v1/users/create").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"bob@itba.edu.ar\",\"name\":\"Bob\",\"career_id\":\"NOPE\"}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("ResourceNotFound"));
    }

    @Test
    void staffCreateDuplicateEmailReturns409() throws Exception {
        var body = "{\"email\":\"dup@itba.edu.ar\"}";
        mvc.perform(post("/v1/users/create").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated());
        mvc.perform(post("/v1/users/create").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("ResourceAlreadyExists"));
    }

    @Test
    void staffCreateWithBadEmailReturns400() throws Exception {
        mvc.perform(post("/v1/users/create").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"not-an-email\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
    }

    @Test
    void staffCanListUsers() throws Exception {
        mvc.perform(post("/v1/users/create").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"alice@itba.edu.ar\",\"name\":\"Alice\"}"))
            .andExpect(status().isCreated());

        mvc.perform(get("/v1/users").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].email").value("alice@itba.edu.ar"))
            .andExpect(jsonPath("$.meta.total").value(1))
            .andExpect(jsonPath("$.meta.page").value(1))
            .andExpect(jsonPath("$.meta.limit").value(20));
    }

    @Test
    void listUsersSupportsSearchSortAndPagination() throws Exception {
        // Seed three users in a deterministic createdAt order: Alice → Bob → Carol.
        for (var u : new String[][] {
                {"alice@itba.edu.ar", "Alice"},
                {"bob@itba.edu.ar",   "Bob"},
                {"carol@itba.edu.ar", "Carol"} }) {
            mvc.perform(post("/v1/users/create").with(staff())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"email\":\"" + u[0] + "\",\"name\":\"" + u[1] + "\"}"))
                .andExpect(status().isCreated());
        }

        // q matches name OR email, case-insensitive substring.
        mvc.perform(get("/v1/users?q=ALI").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].email").value("alice@itba.edu.ar"));

        // sort=oldest puts the earliest createdAt first.
        mvc.perform(get("/v1/users?sort=oldest").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].email").value("alice@itba.edu.ar"))
            .andExpect(jsonPath("$.data[2].email").value("carol@itba.edu.ar"));

        // sort=newest (default) reverses it.
        mvc.perform(get("/v1/users?sort=newest").with(staff()))
            .andExpect(jsonPath("$.data[0].email").value("carol@itba.edu.ar"));

        // limit + page slice the result. limit=2,page=2 in newest order → just Alice.
        mvc.perform(get("/v1/users?sort=newest&page=2&limit=2").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].email").value("alice@itba.edu.ar"))
            .andExpect(jsonPath("$.meta.total").value(3))
            .andExpect(jsonPath("$.meta.page").value(2))
            .andExpect(jsonPath("$.meta.limit").value(2));

        // Meta reports the limit actually applied (capped at 100), not the raw param
        mvc.perform(get("/v1/users?limit=5000&page=0").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(3))
            .andExpect(jsonPath("$.meta.page").value(1))
            .andExpect(jsonPath("$.meta.limit").value(100));
    }

    @Test
    void listUsersFiltersByOrganization() throws Exception {
        organizationRepository.save(new Organization("ceitba", "CEITBA", "CEITBA"));

        for (var u : new String[][] {
                {"alice@itba.edu.ar", "Alice"},
                {"bob@itba.edu.ar",   "Bob"} }) {
            mvc.perform(post("/v1/users/create").with(staff())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"email\":\"" + u[0] + "\",\"name\":\"" + u[1] + "\"}"))
                .andExpect(status().isCreated());
        }
        var alice = userRepository.findByEmail("alice@itba.edu.ar").orElseThrow();
        mvc.perform(post("/v1/users/" + alice.getId() + "/organizations").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"slug\":\"ceitba\",\"role\":\"member\"}"))
            .andExpect(status().isCreated());

        mvc.perform(get("/v1/users?organization=ceitba").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].email").value("alice@itba.edu.ar"));

        mvc.perform(get("/v1/users?organization=does-not-exist").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(0))
            .andExpect(jsonPath("$.meta.total").value(0));
    }

    @Test
    void disallowedEmailReturns403EvenWithStaffAuthorities() throws Exception {
        // The .authorities() override on .with(jwt()) bypasses the converter, but
        // the AuthorizationManager-based allowlist runs at request authorization
        // time and rejects evil@gmail.com regardless of authority claims.
        mvc.perform(post("/v1/users/create")
                .with(jwt().jwt(t -> t.claim("email", "evil@gmail.com"))
                    .authorities(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_STAFF")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"alice@itba.edu.ar\"}"))
            .andExpect(status().isForbidden());
    }
}
