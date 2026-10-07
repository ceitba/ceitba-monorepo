package org.ceitba.api.web.studygroup;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// /v1/study-groups and /v1/me/study-groups end to end against Postgres:
// validation, filters and pagination, membership rules, owner/moderator
// permissions, privacy of emails and contact links, and a concurrent-join
// race that the row lock must win.
@SpringBootTest
@AutoConfigureMockMvc
class StudyGroupControllerIT {

    private static final String OWNER = "owner@itba.edu.ar";
    private static final String ALICE = "alice@itba.edu.ar";
    private static final String BOB = "bob@itba.edu.ar";
    private static final String MOD = "mod@itba.edu.ar";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired ObjectMapper json;

    private User owner;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.\"user\", public.subject CASCADE");
        owner = new User(UUID.randomUUID(), OWNER, "Olivia Owner");
        owner.setAvatarUrl("https://img.example.org/owner.png");
        owner = users.save(owner);
        users.save(new User(UUID.randomUUID(), ALICE, "Alice"));
        users.save(new User(UUID.randomUUID(), BOB, "Bob"));
        users.save(new User(UUID.randomUUID(), MOD, "Mod"));
        jdbc.update("INSERT INTO public.subject (id, name, updated_at) VALUES ('93.41', 'Algebra', now())");
        jdbc.update("INSERT INTO public.subject (id, name, updated_at) VALUES ('72.08', 'Arquitectura', now())");
    }

    private static RequestPostProcessor as(String email, String... roles) {
        String[] effective = roles.length == 0 ? new String[] {"USER"} : roles;
        GrantedAuthority[] authorities = Arrays.stream(effective)
            .map(r -> new SimpleGrantedAuthority("ROLE_" + r))
            .toArray(GrantedAuthority[]::new);
        // No "name" claim: JIT sync would copy it over the seeded display names.
        return jwt().jwt(t -> t.claim("email", email)).authorities(authorities);
    }

    private static String future(int days) {
        return OffsetDateTime.now().plusDays(days).truncatedTo(ChronoUnit.SECONDS).toString();
    }

    private static String body(String title, String subject, String type, Integer max, int dueInDays) {
        return """
            {"title":"%s","subjectId":"%s","type":"%s","locations":["SDF","VIRTUAL"],
             "dueAt":"%s","description":"Repaso","contactLink":"https://chat.example.org/g",
             "maxParticipants":%s}
            """.formatted(title, subject, type, future(dueInDays), max);
    }

    private ResultActions postGroup(String email, String json) throws Exception {
        return mvc.perform(post("/v1/study-groups").with(as(email))
            .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    private String create(String email, String title, String subject, String type, Integer max, int dueInDays)
            throws Exception {
        var res = postGroup(email, body(title, subject, type, max, dueInDays))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();
        return json.readTree(res).get("id").asText();
    }

    private String create(String email) throws Exception {
        return create(email, "Parcial", "93.41", "EXAMEN", 3, 2);
    }

    private ResultActions join(String email, String id) throws Exception {
        return mvc.perform(post("/v1/study-groups/" + id + "/join").with(as(email)));
    }

    private ResultActions leave(String email, String id) throws Exception {
        return mvc.perform(delete("/v1/study-groups/" + id + "/membership").with(as(email)));
    }

    private UUID userId(String email) {
        return users.findByEmail(email).orElseThrow().getId();
    }

    // Past-due rows can't be created through the API.
    private UUID insertGroup(UUID ownerId, OffsetDateTime dueAt, Integer max) {
        var id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO public.study_groups (id, owner_id, title, subject_id, type, locations, due_at, max_participants)
            VALUES (?, ?, 'Old', '93.41', 'GUIAS', ARRAY['SDR'], ?, ?)
            """, id, ownerId, Timestamp.from(dueAt.toInstant()), max);
        return id;
    }

    // --- create / read --------------------------------------------------------

    @Test
    void createReturnsDetailWithOwnerAsFirstParticipant() throws Exception {
        postGroup(OWNER, body("  Parcial 1  ", "93.41", "EXAMEN", 0, 2))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.title").value("Parcial 1"))
            .andExpect(jsonPath("$.subject.id").value("93.41"))
            .andExpect(jsonPath("$.subject.name").value("Algebra"))
            .andExpect(jsonPath("$.type").value("EXAMEN"))
            .andExpect(jsonPath("$.locations", hasSize(2)))
            .andExpect(jsonPath("$.maxParticipants").doesNotExist())
            .andExpect(jsonPath("$.participantCount").value(1))
            .andExpect(jsonPath("$.isOwner").value(true))
            .andExpect(jsonPath("$.isMember").value(true))
            .andExpect(jsonPath("$.isFull").value(false))
            .andExpect(jsonPath("$.canEdit").value(true))
            .andExpect(jsonPath("$.contactLink").value("https://chat.example.org/g"))
            .andExpect(jsonPath("$.participants", hasSize(1)))
            .andExpect(jsonPath("$.participants[0].name").value("Olivia Owner"))
            .andExpect(jsonPath("$.participants[0].avatarUrl").value("https://img.example.org/owner.png"))
            .andExpect(jsonPath("$.participants[0].isOwner").value(true));
    }

    @Test
    void nonMembersSeeNoContactLinkAndNobodySeesEmails() throws Exception {
        String id = create(OWNER);
        join(BOB, id).andExpect(status().isOk());

        var body = mvc.perform(get("/v1/study-groups/" + id).with(as(ALICE)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.contactLink").doesNotExist())
            .andExpect(jsonPath("$.isMember").value(false))
            .andExpect(jsonPath("$.canEdit").value(false))
            .andExpect(jsonPath("$.participants", hasSize(2)))
            .andExpect(jsonPath("$.participants[0].email").doesNotExist())
            .andExpect(jsonPath("$.participants[1].name").value("Bob"))
            .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("@itba.edu.ar");

        mvc.perform(get("/v1/study-groups/" + id).with(as(BOB)))
            .andExpect(jsonPath("$.contactLink").value("https://chat.example.org/g"));
    }

    @Test
    void unknownGroupIsNotFound() throws Exception {
        mvc.perform(get("/v1/study-groups/" + UUID.randomUUID()).with(as(ALICE)))
            .andExpect(status().isNotFound());
        join(ALICE, UUID.randomUUID().toString()).andExpect(status().isNotFound());
    }

    @Test
    void createValidatesInput() throws Exception {
        postGroup(OWNER, body("t", "99.99", "EXAMEN", 3, 2)).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("subjectId")));
        postGroup(OWNER, body("t", "93.41", "PARTY", 3, 2)).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("BadRequest"));
        postGroup(OWNER, body("t", "93.41", "EXAMEN", 3, -1)).andExpect(status().isBadRequest());
        postGroup(OWNER, body("t", "93.41", "EXAMEN", 1, 2)).andExpect(status().isBadRequest());
        postGroup(OWNER, body("t", "93.41", "EXAMEN", 51, 2)).andExpect(status().isBadRequest());
        postGroup(OWNER, body("", "93.41", "EXAMEN", 3, 2)).andExpect(status().isBadRequest());
        postGroup(OWNER, body("t", "93.41", "EXAMEN", 3, 2).replace("[\"SDF\",\"VIRTUAL\"]", "[]"))
            .andExpect(status().isBadRequest());
        postGroup(OWNER, body("t", "93.41", "EXAMEN", 3, 2).replace("https://chat.example.org/g", "javascript:alert(1)"))
            .andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public.study_groups", Integer.class)).isZero();
    }

    // --- list -----------------------------------------------------------------

    @Test
    void listShowsUpcomingOnlyByDefaultWithFiltersAndPagination() throws Exception {
        String soon = create(OWNER, "Soon", "93.41", "EXAMEN", 3, 1);
        String later = create(OWNER, "Later", "72.08", "GUIAS", null, 5);
        String mid = create(ALICE, "Mid", "93.41", "GUIAS", null, 3);
        insertGroup(owner.getId(), OffsetDateTime.now().minusDays(1), null);

        mvc.perform(get("/v1/study-groups").with(as(BOB)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data", hasSize(3)))
            .andExpect(jsonPath("$.data[0].id").value(soon))
            .andExpect(jsonPath("$.data[1].id").value(mid))
            .andExpect(jsonPath("$.data[2].id").value(later))
            .andExpect(jsonPath("$.data[0].participants").doesNotExist())
            .andExpect(jsonPath("$.data[0].contactLink").doesNotExist())
            .andExpect(jsonPath("$.data[0].participantCount").value(1))
            .andExpect(jsonPath("$.meta.total").value(3))
            .andExpect(jsonPath("$.meta.page").value(1))
            .andExpect(jsonPath("$.meta.limit").value(20));

        mvc.perform(get("/v1/study-groups").param("upcoming", "false").with(as(BOB)))
            .andExpect(jsonPath("$.meta.total").value(4))
            .andExpect(jsonPath("$.data[0].title").value("Old"));

        mvc.perform(get("/v1/study-groups").param("subject", "93.41").with(as(BOB)))
            .andExpect(jsonPath("$.data", hasSize(2)));
        mvc.perform(get("/v1/study-groups").param("subject", "93.41").param("type", "GUIAS").with(as(BOB)))
            .andExpect(jsonPath("$.data", hasSize(1)))
            .andExpect(jsonPath("$.data[0].id").value(mid));
        mvc.perform(get("/v1/study-groups").param("type", "NOPE").with(as(BOB)))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/v1/study-groups").param("page", "2").param("limit", "2").with(as(BOB)))
            .andExpect(jsonPath("$.data", hasSize(1)))
            .andExpect(jsonPath("$.data[0].id").value(later))
            .andExpect(jsonPath("$.meta.total").value(3))
            .andExpect(jsonPath("$.meta.page").value(2))
            .andExpect(jsonPath("$.meta.limit").value(2));

        // Membership flags and the link follow the caller.
        mvc.perform(get("/v1/study-groups").with(as(ALICE)))
            .andExpect(jsonPath("$.data[1].isMember").value(true))
            .andExpect(jsonPath("$.data[1].isOwner").value(true))
            .andExpect(jsonPath("$.data[1].contactLink").value("https://chat.example.org/g"))
            .andExpect(jsonPath("$.data[0].isMember").value(false));
    }

    @Test
    void meListsOwnedAndJoinedGroups() throws Exception {
        String owned = create(ALICE, "Mine", "93.41", "EXAMEN", null, 3);
        String joined = create(OWNER, "Joined", "93.41", "EXAMEN", null, 1);
        create(OWNER, "Other", "93.41", "EXAMEN", null, 2);
        join(ALICE, joined).andExpect(status().isOk());
        UUID old = insertGroup(owner.getId(), OffsetDateTime.now().minusDays(3), null);
        jdbc.update("INSERT INTO public.study_group_participants (group_id, user_id) VALUES (?, ?)", old, userId(ALICE));

        mvc.perform(get("/v1/me/study-groups").with(as(ALICE)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(2)))
            .andExpect(jsonPath("$[0].id").value(joined))
            .andExpect(jsonPath("$[1].id").value(owned));
        mvc.perform(get("/v1/me/study-groups").param("upcoming", "false").with(as(ALICE)))
            .andExpect(jsonPath("$", hasSize(3)));
        mvc.perform(get("/v1/me/study-groups").with(as(BOB)))
            .andExpect(jsonPath("$", hasSize(0)));
    }

    // --- membership -----------------------------------------------------------

    @Test
    void joinAndLeaveRules() throws Exception {
        String id = create(OWNER, "Duo", "93.41", "TP_GRUPO", 2, 2);

        join(ALICE, id).andExpect(status().isOk())
            .andExpect(jsonPath("$.isMember").value(true))
            .andExpect(jsonPath("$.isFull").value(true))
            .andExpect(jsonPath("$.contactLink").value("https://chat.example.org/g"));
        // Idempotent for members.
        join(ALICE, id).andExpect(status().isOk()).andExpect(jsonPath("$.participantCount").value(2));
        join(BOB, id).andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("StudyGroupFull"));

        leave(ALICE, id).andExpect(status().isNoContent());
        leave(ALICE, id).andExpect(status().isNotFound());
        join(BOB, id).andExpect(status().isOk());

        UUID old = insertGroup(owner.getId(), OffsetDateTime.now().minusMinutes(1), null);
        join(ALICE, old.toString()).andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("StudyGroupPastDue"));
    }

    @Test
    void ownerLeavingTransfersToEarliestJoinerThenDeletesWhenAlone() throws Exception {
        String id = create(OWNER);
        join(BOB, id).andExpect(status().isOk());
        join(ALICE, id).andExpect(status().isOk());

        leave(OWNER, id).andExpect(status().isNoContent());
        mvc.perform(get("/v1/study-groups/" + id).with(as(BOB)))
            .andExpect(jsonPath("$.isOwner").value(true))
            .andExpect(jsonPath("$.canEdit").value(true))
            .andExpect(jsonPath("$.participantCount").value(2))
            .andExpect(jsonPath("$.participants[0].name").value("Bob"))
            .andExpect(jsonPath("$.participants[0].isOwner").value(true));

        leave(ALICE, id).andExpect(status().isNoContent());
        leave(BOB, id).andExpect(status().isNoContent());
        mvc.perform(get("/v1/study-groups/" + id).with(as(BOB))).andExpect(status().isNotFound());
    }

    // --- edit / delete --------------------------------------------------------

    @Test
    void onlyOwnerOrModeratorCanEditAndDelete() throws Exception {
        String id = create(OWNER);
        join(ALICE, id).andExpect(status().isOk());
        String patchTitle = "{\"title\":\"Renamed\"}";

        mvc.perform(patch("/v1/study-groups/" + id).with(as(ALICE))
                .contentType(MediaType.APPLICATION_JSON).content(patchTitle))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("AccessDenied"));
        mvc.perform(delete("/v1/study-groups/" + id).with(as(ALICE))).andExpect(status().isForbidden());

        mvc.perform(patch("/v1/study-groups/" + id).with(as(OWNER))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Renamed\",\"subjectId\":\"72.08\",\"contactLink\":\"\",\"maxParticipants\":0}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Renamed"))
            .andExpect(jsonPath("$.subject.name").value("Arquitectura"))
            .andExpect(jsonPath("$.contactLink").doesNotExist())
            .andExpect(jsonPath("$.maxParticipants").doesNotExist())
            .andExpect(jsonPath("$.description").value("Repaso"));

        mvc.perform(patch("/v1/study-groups/" + id).with(as(MOD, "USER", "MODERATOR"))
                .contentType(MediaType.APPLICATION_JSON).content("{\"maxParticipants\":2}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.canEdit").value(true))
            .andExpect(jsonPath("$.isOwner").value(false));
        join(BOB, id).andExpect(status().isConflict());
        // Can't drop below the two current members.
        mvc.perform(patch("/v1/study-groups/" + id).with(as(OWNER))
                .contentType(MediaType.APPLICATION_JSON).content("{\"maxParticipants\":1}"))
            .andExpect(status().isBadRequest());
        leave(ALICE, id).andExpect(status().isNoContent());
        join(BOB, id).andExpect(status().isOk());
        join(ALICE, id).andExpect(status().isConflict());
        mvc.perform(patch("/v1/study-groups/" + id).with(as(OWNER))
                .contentType(MediaType.APPLICATION_JSON).content("{\"dueAt\":\"2001-01-01T00:00:00Z\"}"))
            .andExpect(status().isBadRequest());

        mvc.perform(delete("/v1/study-groups/" + id).with(as(MOD, "USER", "MODERATOR")))
            .andExpect(status().isNoContent());
        mvc.perform(get("/v1/study-groups/" + id).with(as(OWNER))).andExpect(status().isNotFound());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public.study_group_participants", Integer.class))
            .isZero();
    }

    @Test
    void capacityCannotDropBelowMemberCount() throws Exception {
        String id = create(OWNER, "Trio", "93.41", "AHORA", null, 2);
        join(ALICE, id).andExpect(status().isOk());
        join(BOB, id).andExpect(status().isOk());
        mvc.perform(patch("/v1/study-groups/" + id).with(as(OWNER))
                .contentType(MediaType.APPLICATION_JSON).content("{\"maxParticipants\":2}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("StudyGroupCapacityBelowMembers"));
    }

    // --- auth -----------------------------------------------------------------

    @Test
    void requiresASignedInUser() throws Exception {
        mvc.perform(get("/v1/study-groups")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/me/study-groups")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/study-groups").with(as("sync@itba.edu.ar", "SYNC")))
            .andExpect(status().isForbidden());
        mvc.perform(get("/v1/study-groups").with(as("someone@gmail.com")))
            .andExpect(status().isForbidden());
    }

    // --- concurrency ----------------------------------------------------------

    // Capacity 1 and nobody in it yet (seeded directly: through the API the
    // owner would already fill it). Many users join at once; the row lock must
    // let exactly one in.
    @Test
    void concurrentJoinsNeverExceedCapacity() throws Exception {
        UUID id = insertGroup(owner.getId(), OffsetDateTime.now().plusDays(1), 1);
        int racers = 12;
        List<String> emails = new ArrayList<>();
        for (int i = 0; i < racers; i++) {
            String email = "racer" + i + "@itba.edu.ar";
            users.save(new User(UUID.randomUUID(), email, "Racer " + i));
            emails.add(email);
        }

        ExecutorService pool = Executors.newFixedThreadPool(racers);
        var start = new CountDownLatch(1);
        try {
            List<Future<Integer>> results = new ArrayList<>();
            for (String email : emails) {
                Callable<Integer> call = () -> {
                    start.await();
                    return join(email, id.toString()).andReturn().getResponse().getStatus();
                };
                results.add(pool.submit(call));
            }
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (var f : results) statuses.add(f.get(60, TimeUnit.SECONDS));

            assertThat(statuses).filteredOn(s -> s == 200).hasSize(1);
            assertThat(statuses).filteredOn(s -> s == 409).hasSize(racers - 1);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM public.study_group_participants WHERE group_id = ?", Integer.class, id))
            .isEqualTo(1);
    }
}
