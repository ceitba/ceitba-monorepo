package org.ceitba.api.web.auth;

import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Regression for the prod crash loop: an unquoted hash in .env gets mangled by
// docker compose interpolation (plus a stray zsh `%`). That used to throw in
// ReviewLoginService's constructor and kill the whole API. Now the context
// starts, health is UP, and review login is simply off (404).
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "auth.review-login.email=appreview@example.com",
    // What compose really produced from an unquoted `$2a$12$<salt+hash>%`:
    // `$<salt+hash>` expanded to "" and the zsh `%` kept.
    "auth.review-login.password-hash=$2a$12%"
})
class ReviewLoginMisconfiguredIT {

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;

    @Test
    void appStartsHealthyAndReviewLoginIsDisabled() throws Exception {
        mvc.perform(get("/actuator/health"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("UP"));

        mvc.perform(post("/v1/auth/review-login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"appreview@example.com\",\"password\":\"anything\"}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NotFound"));
        assertThat(users.count()).isZero();
    }
}
