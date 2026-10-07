package org.ceitba.api.web.wiki;

import org.ceitba.api.domain.Subject;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.wiki.SubjectBookmarkRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Exercises the wiki bookmark protected endpoints with a mocked Google ID token,
// proves the two-rule allowlist gate, and verifies the JIT user provisioning
// (first authenticated request creates a User row).
@SpringBootTest
@AutoConfigureMockMvc
class SubjectBookmarkAuthIT {

    @Autowired MockMvc mvc;
    @Autowired SubjectRepository subjectRepository;
    @Autowired UserRepository userRepository;
    @Autowired SubjectBookmarkRepository bookmarkRepository;

    @BeforeEach
    void seed() {
        bookmarkRepository.deleteAll();
        userRepository.deleteAll();
        subjectRepository.deleteAll();
        subjectRepository.save(new Subject("93.12", "Algoritmos", 6));
    }

    private static org.springframework.test.web.servlet.request.RequestPostProcessor jwtFor(String email, String name) {
        return jwt().jwt(token -> token.claim("email", email).claim("name", name).subject(email));
    }

    @Test
    void postCreatesBookmarkAndJitProvisionsUser() throws Exception {
        assertThat(userRepository.findByEmail("alice@itba.edu.ar")).isEmpty();

        mvc.perform(post("/v1/wiki/bookmarks/93.12").with(jwtFor("alice@itba.edu.ar", "Alice")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.count").value(1))
            .andExpect(jsonPath("$.bookmarked").value(true));

        assertThat(userRepository.findByEmail("alice@itba.edu.ar")).isPresent();
        assertThat(bookmarkRepository.count()).isEqualTo(1);
    }

    @Test
    void putIsIdempotent() throws Exception {
        mvc.perform(put("/v1/wiki/bookmarks/93.12").with(jwtFor("alice@itba.edu.ar", "Alice")))
            .andExpect(status().isOk());
        mvc.perform(put("/v1/wiki/bookmarks/93.12").with(jwtFor("alice@itba.edu.ar", "Alice")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.count").value(1)); // not 2
        assertThat(bookmarkRepository.count()).isEqualTo(1);
    }

    @Test
    void deleteRemovesBookmarkAndIs204() throws Exception {
        mvc.perform(post("/v1/wiki/bookmarks/93.12").with(jwtFor("alice@itba.edu.ar", "Alice")))
            .andExpect(status().isOk());
        mvc.perform(delete("/v1/wiki/bookmarks/93.12").with(jwtFor("alice@itba.edu.ar", "Alice")))
            .andExpect(status().isNoContent());

        mvc.perform(get("/v1/wiki/bookmarks/93.12"))
            .andExpect(jsonPath("$.count").value(0));
    }

    @Test
    void deleteWithNoExistingBookmarkIsStill204() throws Exception {
        mvc.perform(delete("/v1/wiki/bookmarks/93.12").with(jwtFor("alice@itba.edu.ar", "Alice")))
            .andExpect(status().isNoContent());
    }

    @Test
    void countIsGlobalEvenForAnonymousReader() throws Exception {
        mvc.perform(post("/v1/wiki/bookmarks/93.12").with(jwtFor("alice@itba.edu.ar", "Alice")))
            .andExpect(status().isOk());
        mvc.perform(post("/v1/wiki/bookmarks/93.12").with(jwtFor("bob@itba.edu.ar", "Bob")))
            .andExpect(status().isOk());

        // Anonymous read sees the global count + bookmarked=false.
        mvc.perform(get("/v1/wiki/bookmarks/93.12"))
            .andExpect(jsonPath("$.count").value(2))
            .andExpect(jsonPath("$.bookmarked").value(false));
    }

    @Test
    void disallowedEmailIsRejectedWith403() throws Exception {
        mvc.perform(post("/v1/wiki/bookmarks/93.12").with(jwtFor("evil@gmail.com", "Evil")))
            .andExpect(status().isForbidden());
        assertThat(bookmarkRepository.count()).isZero();
        // No User row provisioned for a rejected token
        assertThat(userRepository.findByEmail("evil@gmail.com")).isEmpty();
    }

    @Test
    void explicitlyAllowedExternalEmailIsAccepted() throws Exception {
        mvc.perform(post("/v1/wiki/bookmarks/93.12").with(jwtFor("external@gmail.com", "External")))
            .andExpect(status().isOk());
        assertThat(userRepository.findByEmail("external@gmail.com")).isPresent();
    }

    @Test
    void twoConsecutiveAuthenticatedRequestsReuseSameUserRow() throws Exception {
        mvc.perform(post("/v1/wiki/bookmarks/93.12").with(jwtFor("alice@itba.edu.ar", "Alice")))
            .andExpect(status().isOk());
        mvc.perform(delete("/v1/wiki/bookmarks/93.12").with(jwtFor("alice@itba.edu.ar", "Alice")))
            .andExpect(status().isNoContent());

        assertThat(userRepository.count()).isEqualTo(1);
    }
}
