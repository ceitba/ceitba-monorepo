package org.ceitba.api.web.auth;

import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Review login is off unless BOTH the email and the hash are configured. Here
// only the email is set: the endpoint must answer 404, whatever the body.
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "itba.api.use-fake=true",
    "auth.review-login.email=appreview@example.com",
    "auth.review-login.password-hash="
})
class ReviewLoginDisabledIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;

    @Test
    void disabledEndpointAnswers404() throws Exception {
        mvc.perform(post("/v1/auth/review-login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"appreview@example.com\",\"password\":\"anything\"}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NotFound"));
        // No field validation leaks the endpoint either.
        mvc.perform(post("/v1/auth/review-login").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isNotFound());
        mvc.perform(post("/v1/auth/review-login"))
            .andExpect(status().isNotFound());
        assertThat(users.count()).isZero();
    }
}
