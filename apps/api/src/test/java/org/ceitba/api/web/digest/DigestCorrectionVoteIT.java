package org.ceitba.api.web.digest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.domain.SavedSchedule;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.SubjectType;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.correction.ScheduleCorrectionStatus;
import org.ceitba.api.domain.correction.ScheduleCorrectionVoteType;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.SavedScheduleRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.correction.ScheduleCorrectionRepository;
import org.ceitba.api.service.correction.ScheduleCorrectionService;
import org.ceitba.api.service.crypto.ContentHmac;
import org.ceitba.api.service.digest.DigestCorrectionVoteTokens;
import org.ceitba.api.service.push.FakePushGatewayConfig;
import org.ceitba.api.web.correction.dto.ScheduleSlotInput;
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
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// "Tu cuatrimestre" end to end: the reader's section in the preview (subjects,
// wiki link, correction prompt with a signed link) and the public
// correction-vote endpoints behind those links (view never writes; a vote
// counts toward the 3-confirm rule; replay, change, expired, invalid, closed).
@SpringBootTest
@AutoConfigureMockMvc
@Import({FakePushGatewayConfig.class, DigestCorrectionVoteIT.FixedClock.class})
class DigestCorrectionVoteIT {

    // Monday 2026-10-05, 12:00 ART: the second semester is running.
    static final Instant NOW = Instant.parse("2026-10-05T15:00:00Z");

    @TestConfiguration
    static class FixedClock {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(NOW, ZoneId.of("America/Argentina/Buenos_Aires"));
        }
    }

    static final String SUBJECT = "93.41";
    static final String SUBJECT_NAME = "Física I";
    static final String COMMISSION = "45112";
    static final String READER = "lector@itba.edu.ar";
    static final String SUGGESTER = "sugeridor@itba.edu.ar";
    static final String SUGGESTER_NAME = "Sugeridor Secreto";
    static final String URL = "/v1/digests/correction-vote";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository users;
    @Autowired SubjectRepository subjects;
    @Autowired CommissionRepository commissions;
    @Autowired SavedScheduleRepository schedules;
    @Autowired ScheduleCorrectionRepository corrections;
    @Autowired ScheduleCorrectionService correctionService;
    @Autowired DigestCorrectionVoteTokens tokens;
    @Autowired ContentHmac hmac;

    User reader;
    User suggester;
    UUID correctionId;

    @BeforeEach
    void seed() {
        jdbc.execute("""
            TRUNCATE public.schedule_correction, public.saved_schedules, public.commission_time, public.commission,
                     public.subject, public.digest_deliveries, public.digest_issues, public.capability_settings,
                     public."user" CASCADE
            """);
        subjects.save(new Subject(SUBJECT, SUBJECT_NAME, 6));
        var c = new Commission(COMMISSION, SUBJECT, "A", LocalDate.of(2026, 8, 3), LocalDate.of(2026, 12, 5),
            10, 30, SubjectType.SEMESTRAL);
        c.getTimes().add(new CommissionTime(COMMISSION, DayOfWeek.MONDAY, LocalTime.of(8, 0), "102T", "SDT",
            LocalTime.of(11, 0)));
        commissions.save(c);

        reader = users.save(new User(UUID.randomUUID(), READER, "Lector"));
        suggester = users.save(new User(UUID.randomUUID(), SUGGESTER, SUGGESTER_NAME));
        var other = users.save(new User(UUID.randomUUID(), "otro@itba.edu.ar", "Otro"));

        // Suggestion = the suggester's CONFIRM; one more makes 2 of 3.
        correctionId = correctionService.suggest(COMMISSION, suggester.getId(),
            List.of(new ScheduleSlotInput("TUESDAY", "09:00", "12:00"))).correction().id();
        correctionService.vote(correctionId, other.getId(), ScheduleCorrectionVoteType.CONFIRM);
    }

    String token() {
        return tokens.issue(reader.getId(), correctionId);
    }

    ResultActions view(String token) throws Exception {
        return mvc.perform(get(URL).param("token", token));
    }

    ResultActions vote(String token, String vote) throws Exception {
        var body = json.writeValueAsString(Map.of("token", token, "vote", vote));
        return mvc.perform(post(URL).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    JsonNode body(ResultActions r) throws Exception {
        return json.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    void assertAnonymous(String s) {
        assertThat(s).doesNotContain(suggester.getId().toString(), SUGGESTER, SUGGESTER_NAME, "suggester");
    }

    @Test
    void viewShowsTheCorrectionWithoutWritingOrRevealingTheSuggester() throws Exception {
        var res = view(token()).andExpect(status().isOk())
            .andExpect(jsonPath("$.subjectName").value(SUBJECT_NAME))
            .andExpect(jsonPath("$.commissionName").value("A"))
            .andExpect(jsonPath("$.status").value("PENDING"))
            .andExpect(jsonPath("$.open").value(true))
            .andExpect(jsonPath("$.proposed[0].day").value("TUESDAY"))
            .andExpect(jsonPath("$.proposed[0].from").value("09:00"))
            .andExpect(jsonPath("$.sga[0].day").value("MONDAY"))
            .andExpect(jsonPath("$.confirms").value(2))
            .andExpect(jsonPath("$.myVote").doesNotExist());
        assertAnonymous(res.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
        view(token()).andExpect(status().isOk());
        var c = corrections.findById(correctionId).orElseThrow();
        assertThat(c.getConfirmCount()).isEqualTo(2);
        assertThat(c.getStatus()).isEqualTo(ScheduleCorrectionStatus.PENDING);
    }

    @Test
    void voteCountsTowardTheRuleAndAReplayDoesNotCountTwice() throws Exception {
        String t = token();
        var first = body(vote(t, "confirm").andExpect(status().isOk()));
        assertThat(first.at("/previousVote").isNull()).isTrue();
        assertThat(first.at("/correction/myVote").asText()).isEqualTo("CONFIRM");
        assertThat(first.at("/correction/confirms").asInt()).isEqualTo(3);
        assertThat(first.at("/correction/status").asText()).isEqualTo("APPLIED");
        assertAnonymous(first.toString());

        var replay = body(vote(t, "confirm").andExpect(status().isOk()));
        assertThat(replay.at("/previousVote").asText()).isEqualTo("CONFIRM");
        assertThat(replay.at("/correction/confirms").asInt()).isEqualTo(3);

        // Changing the vote replaces it (the service allows it): back to 2 confirms.
        var changed = body(vote(t, "REJECT").andExpect(status().isOk()));
        assertThat(changed.at("/previousVote").asText()).isEqualTo("CONFIRM");
        assertThat(changed.at("/correction/confirms").asInt()).isEqualTo(2);
        assertThat(changed.at("/correction/rejects").asInt()).isEqualTo(1);
        assertThat(changed.at("/correction/status").asText()).isEqualTo("PENDING");
        view(t).andExpect(jsonPath("$.myVote").value("REJECT"));
    }

    @Test
    void expiredInvalidAndBadVoteAreRejected() throws Exception {
        var past = new DigestCorrectionVoteTokens(hmac, Clock.fixed(NOW.minus(Duration.ofDays(15)), ZoneOffset.UTC),
            Duration.ofDays(14));
        String expired = past.issue(reader.getId(), correctionId);
        view(expired).andExpect(status().isGone()).andExpect(jsonPath("$.error").value("TOKEN_EXPIRED"));
        vote(expired, "confirm").andExpect(status().isGone()).andExpect(jsonPath("$.error").value("TOKEN_EXPIRED"));

        String t = token();
        String forged = t.substring(0, t.length() - 2) + (t.endsWith("AA") ? "BB" : "AA");
        view(forged).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_TOKEN"));
        vote(forged, "confirm").andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_TOKEN"));
        mvc.perform(get(URL)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_TOKEN"));
        vote(t, "maybe").andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_VOTE"));

        // An unknown correction (signed, but gone) is a 404.
        view(tokens.issue(reader.getId(), UUID.randomUUID()))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("CORRECTION_NOT_FOUND"));
        assertThat(corrections.findById(correctionId).orElseThrow().getConfirmCount()).isEqualTo(2);
    }

    @Test
    void aClosedCorrectionCanBeViewedButNotVoted() throws Exception {
        correctionService.staffReject(correctionId, suggester.getId());
        view(token()).andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("REJECTED"))
            .andExpect(jsonPath("$.open").value(false));
        vote(token(), "confirm").andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("CORRECTION_CLOSED"));
    }

    @Test
    void aStaleSessionDoesNotGetInTheWay() throws Exception {
        mvc.perform(get(URL).param("token", token()).header("Authorization", "Bearer not-a-jwt"))
            .andExpect(status().isOk());
        var body = json.writeValueAsString(Map.of("token", token(), "vote", "confirm"));
        mvc.perform(post(URL).header("Authorization", "Bearer not-a-jwt")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk());
    }

    // ---- the section in the email ---------------------------------------

    static RequestPostProcessor staffAs(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", "Staff"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    String preview(String email) throws Exception {
        var created = body(mvc.perform(post("/v1/digests").with(staffAs(email))
            .contentType(MediaType.APPLICATION_JSON).content("{\"weekStart\":\"2026-09-28\"}")));
        String id = created.has("id") ? created.get("id").asText()
            : jdbc.queryForObject("SELECT id::text FROM public.digest_issues", String.class);
        return mvc.perform(get("/v1/digests/" + id + "/preview").with(staffAs(email)))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    @Test
    void previewShowsTheReadersOwnSectionWithAWorkingVoteLink() throws Exception {
        var s = new SavedSchedule(reader.getId(), "2C", Map.of("version", 1,
            "selectedCourses", List.of(Map.of("subject_id", SUBJECT, "selectedCommissions", List.of("A")))));
        s.setPrimary(true);
        schedules.save(s);
        jdbc.update("INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)");
        jdbc.update("""
            INSERT INTO wiki.kb_page (subject_id, slug, type, title, summary, markdown, generator, generated_at)
            VALUES (?, 'index', 'INDEX', 'Física I', 'Resumen', '# Física I', 'test', '2026-09-30T12:00:00-03:00')
            """, SUBJECT);

        String html = preview(READER);
        assertThat(html).contains("Tu cuatrimestre", SUBJECT_NAME, "com. A",
            "https://ceitba.org.ar/apuntes/93.41?vista=wiki", "actualizado esta semana",
            "Alguien reportó que Física I (com. A) se dicta martes 09:00 a 12:00 en vez de lunes 08:00 a 11:00",
            "/correction?token=", "vote=confirm", "vote=reject");
        assertAnonymous(html);

        var m = Pattern.compile("/correction\\?token=([^&\"]+)&amp;vote=confirm").matcher(html);
        assertThat(m.find()).isTrue();
        String t = URLDecoder.decode(m.group(1), StandardCharsets.UTF_8);
        vote(t, "confirm").andExpect(status().isOk()).andExpect(jsonPath("$.correction.status").value("APPLIED"));

        // Voted: the prompt is gone from the next rendering.
        jdbc.execute("TRUNCATE public.digest_issues CASCADE");
        assertThat(preview(READER)).contains(SUBJECT_NAME).doesNotContain("Alguien reportó");
    }

    @Test
    void theSuggesterIsNotAskedAndAReaderWithoutScheduleGetsTheCallToAction() throws Exception {
        var s = new SavedSchedule(suggester.getId(), "2C", Map.of("version", 1,
            "selectedCourses", List.of(Map.of("subject_id", SUBJECT, "selectedCommissions", List.of("A")))));
        s.setPrimary(true);
        schedules.save(s);
        String html = preview(SUGGESTER);
        assertThat(html).contains("Tu cuatrimestre", SUBJECT_NAME).doesNotContain("Alguien reportó")
            .doesNotContain("vista=wiki");   // no apuntes capability

        jdbc.execute("TRUNCATE public.digest_issues CASCADE");
        assertThat(preview(READER)).contains("Armá tu horario en el combinador", "https://ceitba.org.ar/scheduler/")
            .doesNotContain("Alguien reportó");
    }
}
