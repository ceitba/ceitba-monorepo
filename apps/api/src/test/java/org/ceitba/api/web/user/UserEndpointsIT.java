package org.ceitba.api.web.user;

import org.ceitba.api.domain.Career;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class UserEndpointsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired UserRepository userRepository;
    @Autowired CareerRepository careerRepository;

    @BeforeEach
    void seed() {
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
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].email").value("alice@itba.edu.ar"));
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
