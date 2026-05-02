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

    private static RequestPostProcessor authedAs(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", email).subject(email));
    }

    @Test
    void anonymousCreateReturns401() throws Exception {
        var body = """
            {"email":"alice@itba.edu.ar","name":"Alice"}""";
        mvc.perform(post("/v1/users/create").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void anonymousListReturns401() throws Exception {
        mvc.perform(get("/v1/users")).andExpect(status().isUnauthorized());
    }

    @Test
    void createUserReturns201WithBody() throws Exception {
        var body = """
            {"email":"alice@itba.edu.ar","name":"Alice","file_number":12345,"career_id":"S","plan":"S10-Rev23"}""";
        mvc.perform(post("/v1/users/create")
                .with(authedAs("admin@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").exists())
            .andExpect(jsonPath("$.email").value("alice@itba.edu.ar"))
            .andExpect(jsonPath("$.name").value("Alice"))
            .andExpect(jsonPath("$.file_number").value(12345))
            .andExpect(jsonPath("$.career_id").value("S"));
    }

    @Test
    void createWithUnknownCareerReturns404() throws Exception {
        var body = """
            {"email":"bob@itba.edu.ar","name":"Bob","career_id":"NOPE"}""";
        mvc.perform(post("/v1/users/create")
                .with(authedAs("admin@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("ResourceNotFound"));
    }

    @Test
    void createDuplicateEmailReturns409() throws Exception {
        var body = """
            {"email":"dup@itba.edu.ar"}""";
        mvc.perform(post("/v1/users/create")
                .with(authedAs("admin@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated());
        mvc.perform(post("/v1/users/create")
                .with(authedAs("admin@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("ResourceAlreadyExists"));
    }

    @Test
    void createWithBadEmailReturns400() throws Exception {
        var body = """
            {"email":"not-an-email"}""";
        mvc.perform(post("/v1/users/create")
                .with(authedAs("admin@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
    }

    @Test
    void getAllReturnsCreatedUsers() throws Exception {
        var body = """
            {"email":"alice@itba.edu.ar","name":"Alice"}""";
        mvc.perform(post("/v1/users/create")
                .with(authedAs("admin@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated());

        // JIT provisioning only fires for endpoints whose controller asks for
        // @CurrentUser. /v1/users does not, so listing returns just alice.
        mvc.perform(get("/v1/users").with(authedAs("admin@itba.edu.ar")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].email").value("alice@itba.edu.ar"));
    }

    @Test
    void disallowedEmailIsRejectedWith403() throws Exception {
        var body = """
            {"email":"alice@itba.edu.ar"}""";
        mvc.perform(post("/v1/users/create")
                .with(authedAs("evil@gmail.com"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isForbidden());
    }
}
