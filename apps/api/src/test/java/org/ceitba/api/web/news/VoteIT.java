package org.ceitba.api.web.news;

import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.ArticleVote;
import org.ceitba.api.domain.news.VoteRecord;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.ArticleVoteRepository;
import org.ceitba.api.repository.news.VoteRecordRepository;
import org.ceitba.api.service.crypto.ContentHmac;
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

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HexFormat;
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
    @Autowired VoteRecordRepository recordRepo;
    @Autowired ContentHmac hmac;

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

    // -- Keyed fingerprints & legacy migration ----------------------------------

    private static final String IP = "198.51.100.42";
    private static final String UA = "Mozilla/5.0 (test)";

    private String hmacFingerprint() {
        return hmac.signHex(ContentHmac.VOTE_FINGERPRINTS, IP + "|" + UA);
    }

    // What vote_records held before the HMAC switch: unkeyed SHA-256.
    private static String legacyFingerprint() throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
            .digest((IP + "|" + UA).getBytes(StandardCharsets.UTF_8)));
    }

    private List<String> storedFingerprints() {
        return recordRepo.findAll().stream().map(r -> r.getId().getFingerprint()).toList();
    }

    private void seedLegacyUpVote(OffsetDateTime createdAt) throws Exception {
        recordRepo.save(new VoteRecord("v-art", legacyFingerprint(), "up", createdAt));
        var agg = new ArticleVote("v-art");
        agg.incrementUp();
        voteRepo.save(agg);
    }

    @Test
    void newVotesAreStoredUnderTheHmacFingerprint() throws Exception {
        mvc.perform(post("/v1/articles/v-art/votes")
                .header("X-Forwarded-For", IP)
                .header("User-Agent", UA)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"up\"}"))
            .andExpect(status().isOk());

        assertThat(storedFingerprints())
            .containsExactly(hmacFingerprint())
            .doesNotContain(legacyFingerprint());
    }

    @Test
    void legacyVoteIsRecognizedAndRekeyedOnRecast() throws Exception {
        var castAt = OffsetDateTime.now().minusDays(10).truncatedTo(ChronoUnit.MICROS);
        seedLegacyUpVote(castAt);

        // Same voter, same vote: still one vote, row migrated to the HMAC key.
        var counts = voteService.cast("v-art", IP, UA, "up");

        assertThat(counts.getUpCount()).isEqualTo(1);
        assertThat(storedFingerprints()).containsExactly(hmacFingerprint());
        assertThat(recordRepo.findAll().get(0).getCreatedAt().toInstant()).isEqualTo(castAt.toInstant());

        // And from now on it's found directly under the HMAC key.
        assertThat(voteService.cast("v-art", IP, UA, "up").getUpCount()).isEqualTo(1);
    }

    @Test
    void legacyVoteIsRetractedWhenTheVoterSwitchesType() throws Exception {
        seedLegacyUpVote(null);

        var counts = voteService.cast("v-art", IP, UA, "down");

        assertThat(counts.getUpCount()).isZero();
        assertThat(counts.getDownCount()).isEqualTo(1);
        assertThat(storedFingerprints()).containsExactly(hmacFingerprint());
    }

    @Test
    void legacyVoteCanBeRetracted() throws Exception {
        seedLegacyUpVote(null);

        var counts = voteService.retract("v-art", IP, UA);

        assertThat(counts.getUpCount()).isZero();
        assertThat(recordRepo.findAll()).isEmpty();
    }
}
