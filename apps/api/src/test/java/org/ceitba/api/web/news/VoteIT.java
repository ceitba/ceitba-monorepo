package org.ceitba.api.web.news;

import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.ArticleVote;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.ArticleVoteRepository;
import org.ceitba.api.service.news.VoteService;
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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
// Production setting (behind Caddy): MockMvc's 127.0.0.1 peer is the proxy.
@TestPropertySource(properties = "rate-limit.trust-forwarded-for=true")
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
    @Autowired VoteService voteService;

    @BeforeEach
    void seed() {
        voteRepo.deleteAll();
        articleRepo.deleteAll();
        articleRepo.save(new Article("v-art", "Votable", "e", List.of(), "tech", List.of("A")));
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

    // -- Client identity & concurrency -----------------------------------------

    // The left-most X-Forwarded-For entry is client-controlled: rotating it
    // must not mint new voters. Only the proxy-observed (right-most) one counts.
    @Test
    void spoofedLeftMostForwardedForDoesNotCreateExtraVotes() throws Exception {
        for (String spoofed : List.of("1.1.1.1", "2.2.2.2", "3.3.3.3")) {
            mvc.perform(post("/v1/articles/v-art/votes")
                    .header("X-Forwarded-For", spoofed + ", 198.51.100.7")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"type\":\"up\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.up").value(1));
        }
    }

    // Counters were read-modify-write without a lock: concurrent votes lost
    // updates. Every distinct client's vote must be counted.
    @Test
    void concurrentVotesFromDistinctClientsAreAllCounted() throws Exception {
        int clients = 16;
        var pool = Executors.newFixedThreadPool(clients);
        var start = new CountDownLatch(1);
        try {
            var futures = new ArrayList<Future<?>>();
            for (int i = 0; i < clients; i++) {
                String ip = "198.51.100." + i;
                futures.add(pool.submit(() -> {
                    start.await();
                    return voteService.cast("v-art", ip, "UA", "up");
                }));
            }
            start.countDown();
            for (var f : futures) f.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        assertThat(voteRepo.findById("v-art").orElseThrow().getUpCount()).isEqualTo(clients);
    }
}
