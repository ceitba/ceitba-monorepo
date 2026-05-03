package org.ceitba.api.web.news;

import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.ArticleVote;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.ArticleVoteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class VoteIT {

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
    @Autowired ArticleVoteRepository voteRepo;

    @BeforeEach
    void seed() {
        voteRepo.deleteAll();
        articleRepo.deleteAll();
        articleRepo.save(new Article("v-art", "Votable", "e", List.of(), "tech", "A"));
    }

    // -- GET counts ------------------------------------------------------------

    @Test
    void getCountsReturnsZerosForNewArticle() throws Exception {
        mvc.perform(get("/v1/articles/v-art/votes"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.up").value(0))
            .andExpect(jsonPath("$.down").value(0));
    }

    @Test
    void getCountsReflectsExistingAggregate() throws Exception {
        var agg = new ArticleVote("v-art");
        agg.incrementUp();
        agg.incrementUp();
        voteRepo.save(agg);

        mvc.perform(get("/v1/articles/v-art/votes"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.up").value(2))
            .andExpect(jsonPath("$.down").value(0));
    }

    // -- Cast vote -------------------------------------------------------------

    @Test
    void castUpVoteIncrementsCount() throws Exception {
        mvc.perform(post("/v1/articles/v-art/votes")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"up\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.up").value(1))
            .andExpect(jsonPath("$.down").value(0));
    }

    @Test
    void castingTheSameVoteTwiceIsIdempotent() throws Exception {
        mvc.perform(post("/v1/articles/v-art/votes")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"up\"}"))
            .andExpect(jsonPath("$.up").value(1));

        // Same fingerprint (same test process IP + UA) — no-op
        mvc.perform(post("/v1/articles/v-art/votes")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"up\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.up").value(1));
    }

    @Test
    void changingVoteTypeRetractsOldAndAppliesNew() throws Exception {
        mvc.perform(post("/v1/articles/v-art/votes")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"up\"}"))
            .andExpect(jsonPath("$.up").value(1));

        mvc.perform(post("/v1/articles/v-art/votes")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"down\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.up").value(0))
            .andExpect(jsonPath("$.down").value(1));
    }

    @Test
    void invalidVoteTypeReturns400() throws Exception {
        mvc.perform(post("/v1/articles/v-art/votes")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"sideways\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void voteOnUnknownArticleReturns404() throws Exception {
        mvc.perform(post("/v1/articles/nope/votes")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"up\"}"))
            .andExpect(status().isNotFound());
    }

    // -- Retract vote ----------------------------------------------------------

    @Test
    void retractVoteDecrements() throws Exception {
        mvc.perform(post("/v1/articles/v-art/votes")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"up\"}"))
            .andExpect(jsonPath("$.up").value(1));

        mvc.perform(delete("/v1/articles/v-art/votes"))
            .andExpect(status().isNoContent());

        mvc.perform(get("/v1/articles/v-art/votes"))
            .andExpect(jsonPath("$.up").value(0));
    }

    @Test
    void retractWithNoPriorVoteReturns404() throws Exception {
        mvc.perform(delete("/v1/articles/v-art/votes"))
            .andExpect(status().isNotFound());
    }
}
