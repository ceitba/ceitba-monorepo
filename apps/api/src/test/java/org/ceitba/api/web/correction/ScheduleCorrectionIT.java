package org.ceitba.api.web.correction;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.domain.Plan;
import org.ceitba.api.domain.PlanSubject;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.SubjectType;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.correction.ScheduleCorrectionStatus;
import org.ceitba.api.domain.correction.ScheduleCorrectionVoteType;
import org.ceitba.api.external.itba.CommissionProjection;
import org.ceitba.api.external.itba.CommissionQuery;
import org.ceitba.api.external.itba.FakeItbaApiClient;
import org.ceitba.api.external.itba.SubjectPlanProjection;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.correction.ScheduleCorrectionRepository;
import org.ceitba.api.service.correction.ScheduleCorrectionService;
import org.ceitba.api.service.push.FakePushGateway;
import org.ceitba.api.service.push.FakePushGatewayConfig;
import org.ceitba.api.service.push.events.PushToUsers;
import org.ceitba.api.service.sync.DataSyncService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Student schedule corrections end to end: suggest/validate/dedupe, vote
// thresholds, staff overrides, the GET /v1/subjects and /v1/commissions
// overlays, sync expiry, the applied push, "my corrections", concurrency
// and anonymity.
@SpringBootTest
@AutoConfigureMockMvc
@RecordApplicationEvents
@Import({FakePushGatewayConfig.class, ScheduleCorrectionIT.FixedClock.class})
class ScheduleCorrectionIT {

    // 2026-10-02 in ART: the second semester is running.
    @TestConfiguration
    static class FixedClock {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(Instant.parse("2026-10-02T15:00:00Z"),
                ZoneId.of("America/Argentina/Buenos_Aires"));
        }
    }

    static final String PLAN = "S10-Rev23";
    static final String SUBJECT = "31.08";
    static final String SUBJECT_NAME = "Sistemas de Representación";
    static final String COMMISSION = "45112";
    static final String OTHER_COMMISSION = "45113";
    static final String ENDED_COMMISSION = "40001";
    static final String SUGGESTER = "sugeridor@itba.edu.ar";
    static final String SUGGESTER_NAME = "Sugeridor Secreto";
    static final String STAFF = "staff@itba.edu.ar";

    // SGA: MONDAY 08-11 (102T/SDT), WEDNESDAY 08-10 (201F/SDF).
    // P1 moves the Monday class to Tuesday 09-12.
    static final String P1 = slots("TUESDAY 09:00-12:00", "WEDNESDAY 08:00-10:00");
    static final String P2 = slots("TUESDAY 10:00-13:00", "WEDNESDAY 08:00-10:00");

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository users;
    @Autowired CommissionRepository commissions;
    @Autowired SubjectRepository subjects;
    @Autowired CareerRepository careers;
    @Autowired PlanRepository plans;
    @Autowired PlanSubjectRepository planSubjects;
    @Autowired ScheduleCorrectionRepository corrections;
    @Autowired ScheduleCorrectionService service;
    @Autowired DataSyncService sync;
    @Autowired FakeItbaApiClient itba;
    @Autowired FakePushGateway gateway;
    @Autowired ApplicationEvents events;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.schedule_correction, public.\"user\", public.commission_time, "
            + "public.commission, public.plan_subject, public.subject, public.plan, public.careers CASCADE");
        itba.reset();
        gateway.reset();

        var career = careers.save(new Career("S", "Sistemas"));
        plans.save(new Plan(PLAN, career, "Plan 2023"));
        subjects.save(new Subject(SUBJECT, SUBJECT_NAME, 3));
        planSubjects.save(new PlanSubject(SUBJECT, PLAN, "Ciclo", 1, 1, 0, List.of()));
        itba.stubPlan(PLAN, List.of(new SubjectPlanProjection(SUBJECT, PLAN, "Ciclo", 1, 1,
            List.of(), null, SUBJECT_NAME, 3)));

        commission(COMMISSION, "G", LocalDate.of(2026, 12, 15));
        commission(OTHER_COMMISSION, "B", LocalDate.of(2026, 12, 15));
        commission(ENDED_COMMISSION, "G", LocalDate.of(2026, 7, 25));
    }

    private void commission(String id, String name, LocalDate end) {
        var c = new Commission(id, SUBJECT, name, end.minusMonths(4), end, 10, 30, SubjectType.SEMESTRAL);
        c.getTimes().add(new CommissionTime(id, DayOfWeek.MONDAY, LocalTime.of(8, 0), "102T", "SDT",
            LocalTime.of(11, 0)));
        c.getTimes().add(new CommissionTime(id, DayOfWeek.WEDNESDAY, LocalTime.of(8, 0), "201F", "SDF",
            LocalTime.of(10, 0)));
        commissions.save(c);
    }

    // ---- helpers ---------------------------------------------------------

    static String slots(String... specs) {
        var parts = Arrays.stream(specs).map(s -> {
            String[] dayAndTimes = s.split(" ");
            String[] times = dayAndTimes[1].split("-");
            return "{\"day\":\"" + dayAndTimes[0] + "\",\"time_from\":\"" + times[0]
                + "\",\"time_to\":\"" + times[1] + "\"}";
        }).toList();
        return "{\"schedule\":[" + String.join(",", parts) + "]}";
    }

    static RequestPostProcessor as(String email, String... roles) {
        GrantedAuthority[] authorities = Arrays.stream(roles.length == 0 ? new String[]{"USER"} : roles)
            .map(r -> new SimpleGrantedAuthority("ROLE_" + r))
            .toArray(GrantedAuthority[]::new);
        String name = email.equals(SUGGESTER) ? SUGGESTER_NAME : email;
        return jwt().jwt(t -> t.claim("email", email).claim("name", name)).authorities(authorities);
    }

    static RequestPostProcessor student(int n) {
        return as("alumno" + n + "@itba.edu.ar");
    }

    static RequestPostProcessor staff() {
        return as(STAFF, "USER", "STAFF");
    }

    private ResultActions suggestAs(RequestPostProcessor who, String commissionId, String body) throws Exception {
        return mvc.perform(post("/v1/commissions/" + commissionId + "/schedule-corrections").with(who)
            .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private String suggestOk(RequestPostProcessor who, String body) throws Exception {
        String res = body(suggestAs(who, COMMISSION, body).andExpect(status().isCreated()));
        return json.readTree(res).at("/correction/id").asText();
    }

    private ResultActions voteAs(RequestPostProcessor who, String id, String type) throws Exception {
        return mvc.perform(put("/v1/schedule-corrections/" + id + "/vote").with(who)
            .contentType(MediaType.APPLICATION_JSON).content("{\"type\":\"" + type + "\"}"));
    }

    private JsonNode vote(RequestPostProcessor who, String id, String type) throws Exception {
        return json.readTree(body(voteAs(who, id, type).andExpect(status().isOk())));
    }

    private static String body(ResultActions r) throws Exception {
        return r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private ScheduleCorrectionStatus statusOf(String id) {
        return corrections.findById(UUID.fromString(id)).orElseThrow().getStatus();
    }

    private long appliedPushEvents() {
        return events.stream(PushToUsers.class)
            .filter(e -> ScheduleCorrectionService.PUSH_TYPE.equals(e.message().data().get("type")))
            .count();
    }

    private JsonNode subjectsCommission(RequestPostProcessor who) throws Exception {
        var req = get("/v1/subjects?plan=" + PLAN);
        if (who != null) req = req.with(who);
        JsonNode root = json.readTree(body(mvc.perform(req).andExpect(status().isOk())));
        for (var c : root.at("/Ciclo/1/1/0/commissions")) {
            if (COMMISSION.equals(c.get("commission_id").asText())) return c;
        }
        throw new AssertionError("commission not listed: " + root);
    }

    private void assertAnonymous(String responseBody) {
        var suggester = users.findByEmail(SUGGESTER).orElseThrow();
        assertThat(responseBody)
            .doesNotContain(suggester.getId().toString())
            .doesNotContain(SUGGESTER)
            .doesNotContain(SUGGESTER_NAME)
            .doesNotContain("suggester");
    }

    // ---- suggest ---------------------------------------------------------

    @Test
    void suggestionIsCreatedPendingWithTheSuggestersConfirm() throws Exception {
        String res = body(suggestAs(as(SUGGESTER), COMMISSION,
                slots("WEDNESDAY 08:00:00-10:00:00", "TUESDAY 09:00-12:00"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.created").value(true))
            .andExpect(jsonPath("$.correction.commissionId").value(COMMISSION))
            .andExpect(jsonPath("$.correction.status").value("PENDING"))
            .andExpect(jsonPath("$.correction.confirms").value(1))
            .andExpect(jsonPath("$.correction.rejects").value(0))
            .andExpect(jsonPath("$.correction.myVote").value("CONFIRM"))
            .andExpect(jsonPath("$.correction.createdAt").isNotEmpty())
            // normalized: sorted by day, HH:mm:ss, rooms borrowed by position
            .andExpect(jsonPath("$.correction.schedule", hasSize(2)))
            .andExpect(jsonPath("$.correction.schedule[0].day").value("TUESDAY"))
            .andExpect(jsonPath("$.correction.schedule[0].time_from").value("09:00:00"))
            .andExpect(jsonPath("$.correction.schedule[0].time_to").value("12:00:00"))
            .andExpect(jsonPath("$.correction.schedule[0].classroom").value("102T"))
            .andExpect(jsonPath("$.correction.schedule[0].building").value("SDT"))
            .andExpect(jsonPath("$.correction.schedule[1].day").value("WEDNESDAY"))
            .andExpect(jsonPath("$.correction.schedule[1].classroom").value("201F")));
        assertAnonymous(res);
    }

    @Test
    void invalidSlotsAreRejected() throws Exception {
        List<String> invalid = List.of(
            "{\"schedule\":[]}",
            slots("MONDAY 08:00-09:00", "MONDAY 09:00-10:00", "MONDAY 10:00-11:00", "MONDAY 11:00-12:00",
                "MONDAY 12:00-13:00", "MONDAY 13:00-14:00", "MONDAY 14:00-15:00"),
            slots("SUNDAY 09:00-12:00"),
            slots("FUNDAY 09:00-12:00"),
            slots("TUESDAY 12:00-09:00"),
            slots("TUESDAY 09:00-09:00"),
            slots("TUESDAY 06:30-09:00"),
            slots("TUESDAY 21:00-23:45"),
            slots("TUESDAY 9:00-12:00"),
            slots("TUESDAY 09:00:30-12:00"),
            slots("TUESDAY 09:00-12:00", "TUESDAY 11:00-13:00"),
            slots("TUESDAY 09:00-12:00", "TUESDAY 09:00-12:00"));
        for (String body : invalid) {
            suggestAs(student(1), COMMISSION, body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("ValidationError"));
        }
        // Missing schedule (bean validation) and back-to-back slots (valid).
        suggestAs(student(1), COMMISSION, "{}").andExpect(status().isBadRequest());
        suggestAs(student(1), COMMISSION, slots("TUESDAY 09:00-11:00", "TUESDAY 11:00-13:00"))
            .andExpect(status().isCreated());
        assertThat(corrections.count()).isEqualTo(1);
    }

    @Test
    void sameAsSgaUnknownAndEndedCommissionsAreRejected() throws Exception {
        suggestAs(student(1), COMMISSION, slots("WEDNESDAY 08:00-10:00", "MONDAY 08:00-11:00"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("SameAsSga"));
        suggestAs(student(1), "nope", P1)
            .andExpect(status().isNotFound());
        suggestAs(student(1), ENDED_COMMISSION, P1)
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("CommissionEnded"));
        assertThat(corrections.count()).isZero();
    }

    @Test
    void anonymousCallersCannotSuggestOrVote() throws Exception {
        mvc.perform(post("/v1/commissions/" + COMMISSION + "/schedule-corrections")
                .contentType(MediaType.APPLICATION_JSON).content(P1))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/me/schedule-corrections")).andExpect(status().isUnauthorized());
        // Outside the allowlist.
        suggestAs(as("someone@gmail.com"), COMMISSION, P1).andExpect(status().isForbidden());
    }

    @Test
    void identicalOpenSuggestionIsReturnedInsteadOfDuplicated() throws Exception {
        String id = suggestOk(as(SUGGESTER), P1);

        String res = body(suggestAs(student(2), COMMISSION,
                slots("WEDNESDAY 08:00-10:00", "TUESDAY 09:00:00-12:00:00"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.created").value(false))
            .andExpect(jsonPath("$.correction.id").value(id))
            .andExpect(jsonPath("$.correction.confirms").value(1))
            .andExpect(jsonPath("$.correction.myVote").value(nullValue())));
        assertAnonymous(res);

        // The suggester re-posting it gets it back too (not AlreadySuggested).
        suggestAs(as(SUGGESTER), COMMISSION, P1)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.correction.myVote").value("CONFIRM"));
        assertThat(corrections.count()).isEqualTo(1);
    }

    @Test
    void oneDifferentPendingSuggestionPerUserAndCommission() throws Exception {
        suggestOk(as(SUGGESTER), P1);
        suggestAs(as(SUGGESTER), COMMISSION, P2)
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("AlreadySuggested"));
        // Another commission is fine.
        suggestAs(as(SUGGESTER), OTHER_COMMISSION, P2).andExpect(status().isCreated());
    }

    // ---- votes -----------------------------------------------------------

    @Test
    void appliesAtThreeConfirmsWithMoreConfirmsThanRejectsAndUnappliesWhenRejectsCatchUp() throws Exception {
        String id = suggestOk(as(SUGGESTER), P1);

        assertThat(vote(student(2), id, "CONFIRM").get("status").asText()).isEqualTo("PENDING");
        var afterReject = vote(student(3), id, "REJECT");
        assertThat(afterReject.get("confirms").asInt()).isEqualTo(2);
        assertThat(afterReject.get("rejects").asInt()).isEqualTo(1);
        assertThat(afterReject.get("myVote").asText()).isEqualTo("REJECT");

        var applied = vote(student(4), id, "CONFIRM");
        assertThat(applied.get("status").asText()).isEqualTo("APPLIED");
        assertThat(applied.get("confirms").asInt()).isEqualTo(3);
        assertThat(appliedPushEvents()).isEqualTo(1);

        vote(student(5), id, "REJECT");
        var unapplied = vote(student(6), id, "REJECT");
        assertThat(unapplied.get("rejects").asInt()).isEqualTo(3);
        assertThat(unapplied.get("status").asText()).isEqualTo("PENDING");

        // Changing a vote counts once; removing it too.
        var changed = vote(student(6), id, "CONFIRM");
        assertThat(changed.get("confirms").asInt()).isEqualTo(4);
        assertThat(changed.get("rejects").asInt()).isEqualTo(2);
        assertThat(changed.get("status").asText()).isEqualTo("APPLIED");

        var removed = json.readTree(body(mvc.perform(delete("/v1/schedule-corrections/" + id + "/vote")
            .with(student(6))).andExpect(status().isOk())));
        assertThat(removed.get("confirms").asInt()).isEqualTo(3);
        assertThat(removed.get("myVote").isNull()).isTrue();
        assertThat(removed.get("status").asText()).isEqualTo("APPLIED");

        // Re-applied, but the suggester was notified only the first time.
        assertThat(appliedPushEvents()).isEqualTo(1);
    }

    @Test
    void threeConfirmsAreNotEnoughWhenRejectsTie() throws Exception {
        String id = suggestOk(as(SUGGESTER), P1);
        vote(student(2), id, "REJECT");
        vote(student(3), id, "REJECT");
        vote(student(4), id, "REJECT");
        vote(student(5), id, "CONFIRM");
        assertThat(vote(student(6), id, "CONFIRM").get("status").asText()).isEqualTo("PENDING");
        assertThat(statusOf(id)).isEqualTo(ScheduleCorrectionStatus.PENDING);
        assertThat(vote(student(7), id, "CONFIRM").get("status").asText()).isEqualTo("APPLIED");
    }

    @Test
    void secondCorrectionReachingTheThresholdSupersedesTheAppliedOne() throws Exception {
        String first = suggestOk(as(SUGGESTER), P1);
        vote(student(2), first, "CONFIRM");
        vote(student(3), first, "CONFIRM");
        assertThat(statusOf(first)).isEqualTo(ScheduleCorrectionStatus.APPLIED);

        String second = suggestOk(student(4), P2);
        vote(student(5), second, "CONFIRM");
        assertThat(vote(student(6), second, "CONFIRM").get("status").asText()).isEqualTo("APPLIED");
        assertThat(statusOf(first)).isEqualTo(ScheduleCorrectionStatus.SUPERSEDED);

        // Final states take no more votes.
        voteAs(student(7), first, "CONFIRM").andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("InvalidState"));
        mvc.perform(delete("/v1/schedule-corrections/" + first + "/vote").with(student(2)))
            .andExpect(status().isConflict());
        assertThat(appliedPushEvents()).isEqualTo(2);
    }

    @Test
    void votesOnUnknownOrEndedCorrectionsFail() throws Exception {
        voteAs(student(1), UUID.randomUUID().toString(), "CONFIRM").andExpect(status().isNotFound());
        voteAs(student(1), "not-a-uuid", "CONFIRM").andExpect(status().isBadRequest());

        String id = suggestOk(as(SUGGESTER), P1);
        voteAs(student(1), id, "MAYBE").andExpect(status().isBadRequest());
        // The course ends: the correction is frozen.
        jdbc.update("UPDATE public.commission SET course_end = '2026-09-30' WHERE id = ?", COMMISSION);
        voteAs(student(1), id, "CONFIRM")
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("CommissionEnded"));
    }

    // ---- staff -----------------------------------------------------------

    @Test
    void staffApplySupersedesAndStaffRejectIsFinal() throws Exception {
        String first = suggestOk(as(SUGGESTER), P1);
        String second = suggestOk(student(2), P2);

        String applied = body(mvc.perform(post("/v1/staff/schedule-corrections/" + second + "/apply").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("APPLIED"))
            .andExpect(jsonPath("$.reviewedByStaff").value(true))
            .andExpect(jsonPath("$.reviewedAt").isNotEmpty())
            .andExpect(jsonPath("$.appliedAt").isNotEmpty())
            .andExpect(jsonPath("$.subjectId").value(SUBJECT))
            .andExpect(jsonPath("$.subjectName").value(SUBJECT_NAME))
            .andExpect(jsonPath("$.commissionName").value("G"))
            .andExpect(jsonPath("$.sgaSchedule", hasSize(2)))
            .andExpect(jsonPath("$.sgaSchedule[0].day").value("MONDAY"))
            .andExpect(jsonPath("$.myVote").doesNotExist()));
        assertAnonymous(applied);
        assertThat(appliedPushEvents()).isEqualTo(1);

        // A staff-applied correction is not un-applied by votes.
        for (int i = 3; i <= 6; i++) vote(student(i), second, "REJECT");
        assertThat(statusOf(second)).isEqualTo(ScheduleCorrectionStatus.APPLIED);

        // Staff apply of `first` supersedes `second`.
        mvc.perform(post("/v1/staff/schedule-corrections/" + first + "/apply").with(staff()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("APPLIED"));
        assertThat(statusOf(second)).isEqualTo(ScheduleCorrectionStatus.SUPERSEDED);

        // Revert = reject; a REJECTED correction never re-applies.
        mvc.perform(post("/v1/staff/schedule-corrections/" + first + "/reject").with(staff()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("REJECTED"));
        voteAs(student(7), first, "CONFIRM").andExpect(status().isConflict());
        mvc.perform(post("/v1/staff/schedule-corrections/" + first + "/apply").with(staff()))
            .andExpect(status().isConflict());
        assertThat(statusOf(first)).isEqualTo(ScheduleCorrectionStatus.REJECTED);

        // List, filtered and paged, anonymous.
        String list = body(mvc.perform(get("/v1/staff/schedule-corrections?status=REJECTED").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data", hasSize(1)))
            .andExpect(jsonPath("$.data[0].id").value(first))
            .andExpect(jsonPath("$.meta.total").value(1)));
        assertAnonymous(list);
        mvc.perform(get("/v1/staff/schedule-corrections?limit=1&page=2").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data", hasSize(1)))
            .andExpect(jsonPath("$.meta.total").value(2))
            .andExpect(jsonPath("$.meta.page").value(2));
        mvc.perform(get("/v1/staff/schedule-corrections?status=NOPE").with(staff()))
            .andExpect(status().isBadRequest());
    }

    // Corrections of a commission whose course has ended stay PENDING/APPLIED
    // forever; the staff list hides them by default and under PENDING and
    // APPLIED, but keeps them under the final statuses.
    @Test
    void staffListHidesOpenCorrectionsOfEndedCommissions() throws Exception {
        String running = suggestOk(as(SUGGESTER), P1);
        String superseded = otherSuggestion(student(2), P1);
        String rejected = otherSuggestion(student(3), P2);
        String applied = otherSuggestion(student(4), slots("FRIDAY 18:00-21:00"));
        String pending = otherSuggestion(student(5), slots("SATURDAY 09:00-12:00"));
        service.staffApply(UUID.fromString(superseded), null);
        service.staffReject(UUID.fromString(rejected), null);
        service.staffApply(UUID.fromString(applied), null);
        assertThat(statusOf(superseded)).isEqualTo(ScheduleCorrectionStatus.SUPERSEDED);
        assertThat(statusOf(pending)).isEqualTo(ScheduleCorrectionStatus.PENDING);

        // Before the course ends every correction is listed.
        mvc.perform(get("/v1/staff/schedule-corrections").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.meta.total").value(5));

        // Ended yesterday (today is 2026-10-02 ART).
        jdbc.update("UPDATE public.commission SET course_end = '2026-10-01' WHERE id = ?", OTHER_COMMISSION);

        mvc.perform(get("/v1/staff/schedule-corrections").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[*].id", contains(running)))
            .andExpect(jsonPath("$.meta.total").value(1));
        mvc.perform(get("/v1/staff/schedule-corrections?status=PENDING").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[*].id", contains(running)))
            .andExpect(jsonPath("$.meta.total").value(1));
        mvc.perform(get("/v1/staff/schedule-corrections?status=APPLIED").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data", hasSize(0)))
            .andExpect(jsonPath("$.meta.total").value(0));
        mvc.perform(get("/v1/staff/schedule-corrections?status=REJECTED").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[*].id", contains(rejected)));
        mvc.perform(get("/v1/staff/schedule-corrections?status=SUPERSEDED").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[*].id", contains(superseded)));

        // Ending today still counts as running.
        jdbc.update("UPDATE public.commission SET course_end = '2026-10-02' WHERE id = ?", OTHER_COMMISSION);
        mvc.perform(get("/v1/staff/schedule-corrections?status=APPLIED").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[*].id", contains(applied)));
        mvc.perform(get("/v1/staff/schedule-corrections?status=PENDING").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.meta.total").value(2));
    }

    private String otherSuggestion(RequestPostProcessor who, String body) throws Exception {
        String res = body(suggestAs(who, OTHER_COMMISSION, body).andExpect(status().isCreated()));
        return json.readTree(res).at("/correction/id").asText();
    }

    @Test
    void staffEndpointsRequireStaff() throws Exception {
        String id = suggestOk(as(SUGGESTER), P1);
        mvc.perform(get("/v1/staff/schedule-corrections").with(student(2))).andExpect(status().isForbidden());
        mvc.perform(post("/v1/staff/schedule-corrections/" + id + "/apply").with(student(2)))
            .andExpect(status().isForbidden());
        mvc.perform(post("/v1/staff/schedule-corrections/" + id + "/reject")).andExpect(status().isUnauthorized());
        assertThat(statusOf(id)).isEqualTo(ScheduleCorrectionStatus.PENDING);
    }

    // ---- overlays --------------------------------------------------------

    @Test
    void subjectsOverlayServesTheEffectiveScheduleAndOpenCorrections() throws Exception {
        // Without corrections: SGA schedule, no sga_schedule key, empty list.
        var plain = subjectsCommission(null);
        assertThat(plain.get("name").asText()).isEqualTo("G");
        assertThat(plain.get("schedule").get(0).get("day").asText()).isEqualTo("MONDAY");
        assertThat(plain.has("sga_schedule")).isFalse();
        assertThat(plain.get("corrections")).isEmpty();

        String applied = suggestOk(as(SUGGESTER), P1);
        vote(student(2), applied, "CONFIRM");
        vote(student(3), applied, "CONFIRM");
        String pendingLow = suggestOk(student(4), slots("FRIDAY 18:00-21:00"));
        String pendingHigh = suggestOk(student(5), P2);
        vote(student(6), pendingHigh, "CONFIRM");
        vote(student(7), pendingHigh, "REJECT");
        // A rejected one is not listed.
        String rejected = suggestOk(student(8), slots("SATURDAY 09:00-12:00"));
        service.staffReject(UUID.fromString(rejected), null);

        var anon = subjectsCommission(null);
        assertThat(anon.get("commission_id").asText()).isEqualTo(COMMISSION);
        var schedule = anon.get("schedule");
        assertThat(schedule).hasSize(2);
        assertThat(schedule.get(0).get("day").asText()).isEqualTo("TUESDAY");
        assertThat(schedule.get(0).get("time_from").asText()).isEqualTo("09:00:00");
        assertThat(schedule.get(0).get("time_to").asText()).isEqualTo("12:00:00");
        assertThat(schedule.get(0).get("classroom").asText()).isEqualTo("102T");
        assertThat(schedule.get(0).get("building").asText()).isEqualTo("SDT");
        assertThat(schedule.get(1).get("day").asText()).isEqualTo("WEDNESDAY");
        assertThat(anon.get("sga_schedule").get(0).get("day").asText()).isEqualTo("MONDAY");
        assertThat(anon.get("sga_schedule").get(0).get("time_from").asText()).isEqualTo("08:00:00");

        var list = anon.get("corrections");
        assertThat(list).hasSize(3);
        assertThat(list.get(0).get("id").asText()).isEqualTo(applied);
        assertThat(list.get(0).get("status").asText()).isEqualTo("APPLIED");
        assertThat(list.get(0).get("confirms").asInt()).isEqualTo(3);
        assertThat(list.get(1).get("id").asText()).isEqualTo(pendingHigh);
        assertThat(list.get(1).get("confirms").asInt()).isEqualTo(2);
        assertThat(list.get(1).get("rejects").asInt()).isEqualTo(1);
        assertThat(list.get(2).get("id").asText()).isEqualTo(pendingLow);
        // An extra slot beyond the SGA count would get empty rooms; FRIDAY is slot 0.
        assertThat(list.get(2).get("schedule").get(0).get("classroom").asText()).isEqualTo("102T");
        for (var c : list) {
            assertThat(c.has("my_vote")).isTrue();
            assertThat(c.get("my_vote").isNull()).isTrue();
            assertThat(c.get("created_at").asText()).isNotEmpty();
        }
        assertAnonymous(anon.toString());

        // Logged in: the caller's own votes.
        var mine = subjectsCommission(student(7)).get("corrections");
        assertThat(mine.get(0).get("my_vote").isNull()).isTrue();
        assertThat(mine.get(1).get("my_vote").asText()).isEqualTo("REJECT");
        var suggesters = subjectsCommission(as(SUGGESTER)).get("corrections");
        assertThat(suggesters.get(0).get("my_vote").asText()).isEqualTo("CONFIRM");

        // The other commission is untouched.
        JsonNode root = json.readTree(body(mvc.perform(get("/v1/subjects?plan=" + PLAN))));
        for (var c : root.at("/Ciclo/1/1/0/commissions")) {
            if (OTHER_COMMISSION.equals(c.get("commission_id").asText())) {
                assertThat(c.get("schedule").get(0).get("day").asText()).isEqualTo("MONDAY");
                assertThat(c.has("sga_schedule")).isFalse();
            }
        }
    }

    @Test
    void extraCorrectedSlotsHaveEmptyRooms() throws Exception {
        String id = suggestOk(as(SUGGESTER),
            slots("MONDAY 08:00-11:00", "WEDNESDAY 08:00-10:00", "FRIDAY 14:00-16:00"));
        vote(student(2), id, "CONFIRM");
        vote(student(3), id, "CONFIRM");
        var schedule = subjectsCommission(null).get("schedule");
        assertThat(schedule).hasSize(3);
        assertThat(schedule.get(2).get("day").asText()).isEqualTo("FRIDAY");
        assertThat(schedule.get(2).get("classroom").asText()).isEmpty();
        assertThat(schedule.get(2).get("building").asText()).isEmpty();
    }

    @Test
    void commissionsEndpointServesCorrectedTimes() throws Exception {
        String id = suggestOk(as(SUGGESTER), P1);
        vote(student(2), id, "CONFIRM");
        vote(student(3), id, "CONFIRM");

        JsonNode list = json.readTree(body(mvc.perform(get("/v1/commissions?plan=" + PLAN))
            .andExpect(status().isOk())));
        for (var c : list) {
            var times = c.get("times");
            if (COMMISSION.equals(c.get("id").asText())) {
                assertThat(times.get(0).get("day").asText()).isEqualTo("TUESDAY");
                assertThat(times.get(0).get("hourFrom").asText()).isEqualTo("09:00");
                assertThat(times.get(0).get("hourTo").asText()).isEqualTo("12:00");
                assertThat(times.get(0).get("classroom").asText()).isEqualTo("102T");
            } else {
                assertThat(times.get(0).get("day").asText()).isEqualTo("MONDAY");
            }
        }
    }

    // The next term synced before this one ends replaces it in both
    // endpoints, and corrections attach to the commissions actually shown.
    @Test
    void overlaysFollowTheNewestTermInBothEndpoints() throws Exception {
        String current = suggestOk(as(SUGGESTER), P1);
        vote(student(2), current, "CONFIRM");
        vote(student(3), current, "CONFIRM");
        var next = new Commission("48120", SUBJECT, "G", LocalDate.of(2027, 3, 8), LocalDate.of(2027, 7, 10),
            0, 30, SubjectType.SEMESTRAL);
        next.getTimes().add(new CommissionTime("48120", DayOfWeek.MONDAY, LocalTime.of(8, 0), "102T", "SDT",
            LocalTime.of(11, 0)));
        commissions.save(next);
        String nextCorrection = body(suggestAs(student(4), "48120", slots("THURSDAY 14:00-17:00"))
            .andExpect(status().isCreated()));
        String nextId = json.readTree(nextCorrection).at("/correction/id").asText();

        JsonNode root = json.readTree(body(mvc.perform(get("/v1/subjects?plan=" + PLAN))
            .andExpect(status().isOk())));
        var shown = root.at("/Ciclo/1/1/0/commissions");
        assertThat(shown).hasSize(1);
        assertThat(shown.get(0).get("commission_id").asText()).isEqualTo("48120");
        assertThat(shown.get(0).get("schedule").get(0).get("day").asText()).isEqualTo("MONDAY");
        assertThat(shown.get(0).get("corrections")).hasSize(1);
        assertThat(shown.get(0).get("corrections").get(0).get("id").asText()).isEqualTo(nextId);

        JsonNode list = json.readTree(body(mvc.perform(get("/v1/commissions?plan=" + PLAN))
            .andExpect(status().isOk())));
        assertThat(list).hasSize(1);
        assertThat(list.get(0).get("id").asText()).isEqualTo("48120");
        assertThat(list.get(0).get("times").get(0).get("day").asText()).isEqualTo("MONDAY");
    }

    // ---- sync expiry -----------------------------------------------------

    private void syncCommissionSlots(CommissionProjection.TimeSlot... slots) {
        itba.stubCommissions(List.of(new CommissionProjection(COMMISSION, SUBJECT, SUBJECT_NAME, "G",
            LocalDate.of(2026, 8, 15), LocalDate.of(2026, 12, 15), 10, 30, SubjectType.SEMESTRAL,
            List.of(slots))));
        sync.syncCommissionsOnly(CommissionQuery.defaults());
    }

    private static CommissionProjection.TimeSlot slot(DayOfWeek day, int from, int to, String room) {
        return new CommissionProjection.TimeSlot(day, room, "SDT", LocalTime.of(from, 0), LocalTime.of(to, 0));
    }

    @Test
    void syncLeavesCorrectionsAloneWhileSgaSlotsAreUnchanged() throws Exception {
        String id = suggestOk(as(SUGGESTER), P1);
        // Same slots, different room: not a slot change.
        syncCommissionSlots(slot(DayOfWeek.WEDNESDAY, 8, 10, "999"), slot(DayOfWeek.MONDAY, 8, 11, "102T"));
        assertThat(statusOf(id)).isEqualTo(ScheduleCorrectionStatus.PENDING);
    }

    @Test
    void syncResolvesCorrectionsSgaNowAgreesWithAndSupersedesTheRest() throws Exception {
        String agreed = suggestOk(as(SUGGESTER), P1);
        vote(student(2), agreed, "CONFIRM");
        vote(student(3), agreed, "CONFIRM");
        String other = suggestOk(student(4), P2);
        String closed = suggestOk(student(5), slots("FRIDAY 18:00-21:00"));
        service.staffReject(UUID.fromString(closed), null);

        // SGA now says what `agreed` proposed.
        syncCommissionSlots(slot(DayOfWeek.TUESDAY, 9, 12, "102T"), slot(DayOfWeek.WEDNESDAY, 8, 10, "201F"));

        assertThat(statusOf(agreed)).isEqualTo(ScheduleCorrectionStatus.RESOLVED);
        assertThat(statusOf(other)).isEqualTo(ScheduleCorrectionStatus.SUPERSEDED);
        assertThat(statusOf(closed)).isEqualTo(ScheduleCorrectionStatus.REJECTED);

        // The overlay now serves plain SGA and lists nothing.
        var c = subjectsCommission(null);
        assertThat(c.get("schedule").get(0).get("day").asText()).isEqualTo("TUESDAY");
        assertThat(c.has("sga_schedule")).isFalse();
        assertThat(c.get("corrections")).isEmpty();

        // A new suggestion is measured against the new SGA slots.
        suggestAs(student(6), COMMISSION, P1).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("SameAsSga"));
    }

    // ---- push + "my corrections" ------------------------------------------

    @Test
    void applyingPushesOnceToTheSuggesterWithTheContractPayload() throws Exception {
        User suggester = users.save(new User(UUID.randomUUID(), SUGGESTER, SUGGESTER_NAME));
        jdbc.update("INSERT INTO public.user_devices (token, user_id, platform) VALUES ('sug-phone', ?, 'ios')",
            suggester.getId());
        String id = suggestOk(as(SUGGESTER), P1);
        vote(student(2), id, "CONFIRM");
        vote(student(3), id, "CONFIRM");

        await().atMost(Duration.ofSeconds(10)).until(() -> gateway.calls().size() >= 1);
        var call = gateway.calls().get(0);
        assertThat(call.tokens()).containsExactly("sug-phone");
        assertThat(call.message().title()).isEqualTo("Tu corrección fue aplicada");
        assertThat(call.message().body())
            .isEqualTo(SUBJECT_NAME + " · Comisión G: el horario corregido ya se usa en el Combinador.");
        assertThat(call.message().data())
            .containsEntry("type", "schedule_correction_applied")
            .containsEntry("correctionId", id)
            .containsEntry("subjectId", SUBJECT)
            .containsEntry("commissionId", COMMISSION);

        // More confirms: no second push.
        vote(student(4), id, "CONFIRM");
        await().during(Duration.ofMillis(700)).atMost(Duration.ofSeconds(3))
            .until(() -> gateway.calls().size() == 1);
    }

    @Test
    void myCorrectionsListAndSeenNotice() throws Exception {
        String older = suggestOk(as(SUGGESTER), P1);
        String newer = body(suggestAs(as(SUGGESTER), OTHER_COMMISSION, P2).andExpect(status().isCreated()));
        String newerId = json.readTree(newer).at("/correction/id").asText();

        mvc.perform(get("/v1/me/schedule-corrections").with(as(SUGGESTER)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(2)))
            .andExpect(jsonPath("$[0].id").value(newerId))
            .andExpect(jsonPath("$[0].commissionName").value("B"))
            .andExpect(jsonPath("$[1].id").value(older))
            .andExpect(jsonPath("$[1].subjectId").value(SUBJECT))
            .andExpect(jsonPath("$[1].subjectName").value(SUBJECT_NAME))
            .andExpect(jsonPath("$[1].commissionName").value("G"))
            .andExpect(jsonPath("$[1].myVote").value("CONFIRM"))
            .andExpect(jsonPath("$[1].appliedAt").value(nullValue()))
            .andExpect(jsonPath("$[1].seen").value(true));

        vote(student(2), older, "CONFIRM");
        vote(student(3), older, "CONFIRM");
        mvc.perform(get("/v1/me/schedule-corrections").with(as(SUGGESTER)))
            .andExpect(jsonPath("$[1].status").value("APPLIED"))
            .andExpect(jsonPath("$[1].appliedAt").isNotEmpty())
            .andExpect(jsonPath("$[1].seen").value(false));

        // Only the suggester can dismiss it.
        mvc.perform(post("/v1/me/schedule-corrections/" + older + "/seen").with(student(2)))
            .andExpect(status().isNotFound());
        mvc.perform(post("/v1/me/schedule-corrections/" + older + "/seen").with(as(SUGGESTER)))
            .andExpect(status().isNoContent());
        mvc.perform(post("/v1/me/schedule-corrections/" + older + "/seen").with(as(SUGGESTER)))
            .andExpect(status().isNoContent());
        mvc.perform(get("/v1/me/schedule-corrections").with(as(SUGGESTER)))
            .andExpect(jsonPath("$[1].seen").value(true));

        // Others see none of it.
        mvc.perform(get("/v1/me/schedule-corrections").with(student(2)))
            .andExpect(status().isOk()).andExpect(jsonPath("$", hasSize(0)));
    }

    // ---- concurrency + account deletion ------------------------------------

    // Every write locks the commission row, so concurrent votes are all
    // counted and the correction is applied (and its suggester notified)
    // exactly once.
    @Test
    void concurrentVotesAreAllCountedAndApplyOnce() throws Exception {
        String id = suggestOk(as(SUGGESTER), P1);
        int voters = 16;
        var voterIds = new ArrayList<UUID>();
        for (int i = 0; i < voters; i++) {
            voterIds.add(users.save(new User(UUID.randomUUID(), "par" + i + "@itba.edu.ar", "P" + i)).getId());
        }
        var correctionId = UUID.fromString(id);
        var pool = Executors.newFixedThreadPool(voters);
        var start = new CountDownLatch(1);
        try {
            var futures = new ArrayList<Future<?>>();
            for (int i = 0; i < voters; i++) {
                UUID voter = voterIds.get(i);
                var type = i % 4 == 0 ? ScheduleCorrectionVoteType.REJECT : ScheduleCorrectionVoteType.CONFIRM;
                futures.add(pool.submit(() -> {
                    start.await();
                    return service.vote(correctionId, voter, type);
                }));
            }
            start.countDown();
            for (var f : futures) f.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        var c = corrections.findById(correctionId).orElseThrow();
        assertThat(c.getConfirmCount()).isEqualTo(1 + 12);
        assertThat(c.getRejectCount()).isEqualTo(4);
        assertThat(c.getStatus()).isEqualTo(ScheduleCorrectionStatus.APPLIED);
        assertThat(c.getAppliedAt()).isNotNull();
    }

    @Test
    void deletingAccountsKeepsCorrectionsAndFixesCounters() throws Exception {
        String id = suggestOk(as(SUGGESTER), P1);
        vote(student(2), id, "CONFIRM");
        vote(student(3), id, "REJECT");

        mvc.perform(delete("/v1/me").with(student(2))).andExpect(status().is2xxSuccessful());
        mvc.perform(delete("/v1/me").with(as(SUGGESTER))).andExpect(status().is2xxSuccessful());

        var c = corrections.findById(UUID.fromString(id)).orElseThrow();
        assertThat(c.getSuggesterId()).isNull();
        assertThat(c.getConfirmCount()).isZero();
        assertThat(c.getRejectCount()).isEqualTo(1);
    }

    // Deleting an account withdraws its votes like DELETE .../vote would:
    // the status is re-evaluated, not just the counters.
    @Test
    void deletingAnAccountReEvaluatesTheCorrectionsItVotedOn() throws Exception {
        String unapplies = suggestOk(as(SUGGESTER), P1);
        vote(student(2), unapplies, "CONFIRM");
        vote(student(3), unapplies, "CONFIRM");
        assertThat(statusOf(unapplies)).isEqualTo(ScheduleCorrectionStatus.APPLIED);

        String applies = body(suggestAs(student(4), OTHER_COMMISSION, P2).andExpect(status().isCreated()));
        String other = json.readTree(applies).at("/correction/id").asText();
        vote(student(5), other, "CONFIRM");
        vote(student(6), other, "CONFIRM");
        vote(student(3), other, "REJECT");
        vote(student(7), other, "REJECT");
        vote(student(8), other, "REJECT");
        assertThat(statusOf(other)).isEqualTo(ScheduleCorrectionStatus.PENDING);

        // student 3 confirmed the first and rejected the second.
        mvc.perform(delete("/v1/me").with(student(3))).andExpect(status().is2xxSuccessful());

        var first = corrections.findById(UUID.fromString(unapplies)).orElseThrow();
        assertThat(first.getConfirmCount()).isEqualTo(2);
        assertThat(first.getStatus()).isEqualTo(ScheduleCorrectionStatus.PENDING);
        var second = corrections.findById(UUID.fromString(other)).orElseThrow();
        assertThat(second.getConfirmCount()).isEqualTo(3);
        assertThat(second.getRejectCount()).isEqualTo(2);
        assertThat(second.getStatus()).isEqualTo(ScheduleCorrectionStatus.APPLIED);
    }
}
