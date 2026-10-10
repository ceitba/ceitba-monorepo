package org.ceitba.api.web.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.user.SavedScheduleService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// /v1/me/schedules: CRUD, the 5-per-user cap, primary-schedule rules (V22)
// and ownership (another user's schedule is a 404, never a 403).
@SpringBootTest
@AutoConfigureMockMvc
class MeSchedulesIT {

    private static final String ALICE = "alice@itba.edu.ar";
    private static final String BOB = "bob@itba.edu.ar";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired ObjectMapper json;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.\"user\" CASCADE");
        users.save(new User(UUID.randomUUID(), ALICE, "Alice"));
        users.save(new User(UUID.randomUUID(), BOB, "Bob"));
    }

    private static RequestPostProcessor as(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", email))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static String body(String name) {
        return """
            {"name":"%s","careerId":"S","plan":"S10-Rev23",
             "payload":{"commissions":["93.41-A"],"options":{"hideSaturday":true}}}
            """.formatted(name);
    }

    private JsonNode create(String email, String name) throws Exception {
        var res = mvc.perform(post("/v1/me/schedules").with(as(email))
                .contentType(MediaType.APPLICATION_JSON).content(body(name)))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();
        return json.readTree(res);
    }

    @Test
    void crudRoundTripKeepsPayloadOpaque() throws Exception {
        var created = create(ALICE, "Plan A");
        String id = created.get("id").asText();
        assertThat(created.get("payload").get("options").get("hideSaturday").asBoolean()).isTrue();

        mvc.perform(get("/v1/me/schedules/" + id).with(as(ALICE)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Plan A"))
            .andExpect(jsonPath("$.careerId").value("S"))
            .andExpect(jsonPath("$.plan").value("S10-Rev23"))
            .andExpect(jsonPath("$.payload.commissions[0]").value("93.41-A"))
            .andExpect(jsonPath("$.isPrimary").value(true))
            .andExpect(jsonPath("$.primary").doesNotExist());

        mvc.perform(put("/v1/me/schedules/" + id).with(as(ALICE))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Plan B\",\"payload\":{\"anything\":[1,2,3]}}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Plan B"))
            .andExpect(jsonPath("$.careerId").doesNotExist())
            .andExpect(jsonPath("$.payload.anything[2]").value(3))
            .andExpect(jsonPath("$.isPrimary").value(true));

        mvc.perform(get("/v1/me/schedules").with(as(ALICE)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(1)));

        mvc.perform(delete("/v1/me/schedules/" + id).with(as(ALICE)))
            .andExpect(status().isNoContent());
        mvc.perform(get("/v1/me/schedules/" + id).with(as(ALICE)))
            .andExpect(status().isNotFound());
    }

    @Test
    void rejectsInvalidBodies() throws Exception {
        mvc.perform(post("/v1/me/schedules").with(as(ALICE))
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"\",\"payload\":{}}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/me/schedules").with(as(ALICE))
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"x\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void requiresAuthentication() throws Exception {
        mvc.perform(get("/v1/me/schedules")).andExpect(status().isUnauthorized());
    }

    @Test
    void sixthScheduleIsConflict() throws Exception {
        for (int i = 1; i <= 5; i++) create(ALICE, "S" + i);
        mvc.perform(post("/v1/me/schedules").with(as(ALICE))
                .contentType(MediaType.APPLICATION_JSON).content(body("S6")))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("ResourceAlreadyExists"));
        // The cap is per user.
        create(BOB, "Bob's");
    }

    @Test
    void firstScheduleIsPrimaryAndLaterOnesAreNot() throws Exception {
        var first = create(ALICE, "First");
        var second = create(ALICE, "Second");
        assertThat(first.get("isPrimary").asBoolean()).isTrue();
        assertThat(second.get("isPrimary").asBoolean()).isFalse();
        // Another user's first schedule is primary too (index is per user).
        assertThat(create(BOB, "Bob's").get("isPrimary").asBoolean()).isTrue();
    }

    @Test
    void onlyAPayloadChangeMovesPayloadUpdatedAt() throws Exception {
        String id = create(ALICE, "First").get("id").asText();
        // Pretend it was built a long time ago.
        jdbc.update("UPDATE public.saved_schedules SET payload_updated_at = now() - interval '200 days'");
        var before = jdbc.queryForObject("SELECT payload_updated_at FROM public.saved_schedules", java.sql.Timestamp.class);

        // Rename (same payload as created: create() sends an empty-ish payload) and primary toggle.
        var current = mvc.perform(get("/v1/me/schedules/" + id).with(as(ALICE))).andReturn().getResponse().getContentAsString();
        String payload = json.readTree(current).get("payload").toString();
        mvc.perform(put("/v1/me/schedules/" + id).with(as(ALICE)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Renamed\",\"payload\":" + payload + "}"))
            .andExpect(status().isOk());
        mvc.perform(put("/v1/me/schedules/" + id + "/primary").with(as(ALICE))).andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT payload_updated_at FROM public.saved_schedules", java.sql.Timestamp.class))
            .isEqualTo(before);

        mvc.perform(put("/v1/me/schedules/" + id).with(as(ALICE)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Renamed\",\"payload\":{\"changed\":true}}"))
            .andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT payload_updated_at FROM public.saved_schedules", java.sql.Timestamp.class))
            .isAfter(before);
    }

    @Test
    void makePrimaryMovesTheFlagAndIsIdempotent() throws Exception {
        String first = create(ALICE, "First").get("id").asText();
        String second = create(ALICE, "Second").get("id").asText();

        mvc.perform(put("/v1/me/schedules/" + second + "/primary").with(as(ALICE)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(second))
            .andExpect(jsonPath("$.isPrimary").value(true));
        mvc.perform(put("/v1/me/schedules/" + second + "/primary").with(as(ALICE)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.isPrimary").value(true));

        mvc.perform(get("/v1/me/schedules/" + first).with(as(ALICE)))
            .andExpect(jsonPath("$.isPrimary").value(false));
        assertThat(primaryCount(ALICE)).isEqualTo(1);
    }

    @Test
    void deletingThePrimaryPromotesNone() throws Exception {
        String first = create(ALICE, "First").get("id").asText();
        String second = create(ALICE, "Second").get("id").asText();

        mvc.perform(delete("/v1/me/schedules/" + first).with(as(ALICE)))
            .andExpect(status().isNoContent());
        mvc.perform(get("/v1/me/schedules/" + second).with(as(ALICE)))
            .andExpect(jsonPath("$.isPrimary").value(false));
        assertThat(primaryCount(ALICE)).isZero();

        // Not the user's first schedule any more, so it is not auto-promoted.
        assertThat(create(ALICE, "Third").get("isPrimary").asBoolean()).isFalse();
        mvc.perform(put("/v1/me/schedules/" + second + "/primary").with(as(ALICE)))
            .andExpect(status().isOk());
        assertThat(primaryCount(ALICE)).isEqualTo(1);
    }

    // The app's one-time local-schedules upload may POST in parallel: every
    // create must succeed and exactly one must end up primary.
    @Test
    void concurrentFirstCreatesAllSucceedWithOnePrimary() throws Exception {
        int n = SavedScheduleService.MAX_PER_USER;
        var pool = Executors.newFixedThreadPool(n);
        try {
            var start = new CountDownLatch(1);
            var results = new ArrayList<Future<Integer>>();
            for (int i = 0; i < n; i++) {
                String name = "Parallel " + i;
                results.add(pool.submit(() -> {
                    start.await();
                    return mvc.perform(post("/v1/me/schedules").with(as(ALICE))
                            .contentType(MediaType.APPLICATION_JSON).content(body(name)))
                        .andReturn().getResponse().getStatus();
                }));
            }
            start.countDown();
            for (var r : results) assertThat(r.get(30, TimeUnit.SECONDS)).isEqualTo(201);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("""
            SELECT count(*) FROM public.saved_schedules s JOIN public."user" u ON u.id = s.user_id
            WHERE u.email = ?
            """, Integer.class, ALICE)).isEqualTo(n);
        assertThat(primaryCount(ALICE)).isEqualTo(1);
    }

    // Runs the exact backfill statement of V22 (the test mirror V4.15 is
    // DDL-only) on schedules saved before the primary flag existed.
    @Test
    void v22BackfillMakesEachUsersLatestScheduleThePrimary() throws Exception {
        UUID alice = users.findByEmail(ALICE).orElseThrow().getId();
        UUID bob = users.findByEmail(BOB).orElseThrow().getId();
        UUID aliceOld = legacySchedule(alice, "2024-01-01T00:00:00Z");
        UUID aliceLatest = legacySchedule(alice, "2024-03-01T00:00:00Z");
        UUID aliceMid = legacySchedule(alice, "2024-02-01T00:00:00Z");
        UUID bobOnly = legacySchedule(bob, "2023-06-01T00:00:00Z");

        jdbc.execute(v22Backfill());

        assertThat(jdbc.queryForList("SELECT id FROM public.saved_schedules WHERE is_primary", UUID.class))
            .containsExactlyInAnyOrder(aliceLatest, bobOnly);
        assertThat(jdbc.queryForList("SELECT id FROM public.saved_schedules WHERE NOT is_primary", UUID.class))
            .containsExactlyInAnyOrder(aliceOld, aliceMid);
        // Idempotent: a second run picks the same rows.
        jdbc.execute(v22Backfill());
        assertThat(primaryCount(ALICE)).isEqualTo(1);
    }

    private UUID legacySchedule(UUID userId, String updatedAt) {
        return jdbc.queryForObject("""
            INSERT INTO public.saved_schedules (user_id, name, payload, is_primary, updated_at)
            VALUES (?, 'legacy', '{}'::jsonb, FALSE, ?::timestamptz) RETURNING id
            """, UUID.class, userId, updatedAt);
    }

    private static String v22Backfill() throws IOException {
        String sql = new ClassPathResource("db/migration/V22__saved_schedules_primary.sql")
            .getContentAsString(StandardCharsets.UTF_8);
        int start = sql.indexOf("UPDATE saved_schedules s");
        assertThat(start).as("V22 backfill statement").isNotNegative();
        return sql.substring(start);
    }

    @Test
    void databaseRejectsTwoPrimariesForOneUser() throws Exception {
        create(ALICE, "First");
        create(ALICE, "Second");
        assertThatThrownBy(() ->
                jdbc.update("UPDATE public.saved_schedules SET is_primary = TRUE"))
            .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void otherUsersSchedulesAreNotFound() throws Exception {
        String bobs = create(BOB, "Bob's").get("id").asText();

        mvc.perform(get("/v1/me/schedules/" + bobs).with(as(ALICE)))
            .andExpect(status().isNotFound());
        mvc.perform(put("/v1/me/schedules/" + bobs).with(as(ALICE))
                .contentType(MediaType.APPLICATION_JSON).content(body("hijack")))
            .andExpect(status().isNotFound());
        mvc.perform(put("/v1/me/schedules/" + bobs + "/primary").with(as(ALICE)))
            .andExpect(status().isNotFound());
        mvc.perform(delete("/v1/me/schedules/" + bobs).with(as(ALICE)))
            .andExpect(status().isNotFound());
        mvc.perform(get("/v1/me/schedules").with(as(ALICE)))
            .andExpect(jsonPath("$", hasSize(0)));

        mvc.perform(get("/v1/me/schedules/" + bobs).with(as(BOB)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Bob's"));
    }

    private int primaryCount(String email) {
        return jdbc.queryForObject("""
            SELECT count(*) FROM public.saved_schedules s JOIN public."user" u ON u.id = s.user_id
            WHERE u.email = ? AND s.is_primary
            """, Integer.class, email);
    }
}
