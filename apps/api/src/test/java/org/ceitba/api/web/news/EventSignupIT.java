package org.ceitba.api.web.news;

import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.EventRsvpRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.ceitba.api.service.news.EventReminderService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Event sign-up (V56): external link vs built-in RSVP with capacity, the
// attendee list for the org, my RSVPs, the day-before reminder claim and
// event_view analytics.
@SpringBootTest
@AutoConfigureMockMvc
class EventSignupIT {

    @Autowired MockMvc mvc;
    @Autowired UserRepository userRepo;
    @Autowired OrganizationRepository orgRepo;
    @Autowired UserOrganizationRepository membershipRepo;
    @Autowired NewsEventRepository eventRepo;
    @Autowired EventRsvpRepository rsvpRepo;
    @Autowired EventReminderService reminders;
    @Autowired JdbcTemplate jdbc;

    final LocalDate today = LocalDate.now(ClockConfig.ZONE);

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM public.analytics_events");
        rsvpRepo.deleteAll();
        eventRepo.deleteAll();
        membershipRepo.deleteAll();
        userRepo.deleteAll();
        orgRepo.deleteAll();

        orgRepo.save(new Organization("ceitba", "CEITBA", "Centro de Estudiantes"));
        orgRepo.save(new Organization("sabf", "SABF", "South American Business Forum"));
        var alice = userRepo.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
        userRepo.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));
        userRepo.save(new User(UUID.randomUUID(), "carol@itba.edu.ar", "Carol"));
        membershipRepo.save(new UserOrganization(alice.getId(), "sabf", "member"));

        event("rsvp-evt", today.plusDays(7), NewsEvent.SIGNUP_RSVP, 1);
        event("past-evt", today.minusDays(1), NewsEvent.SIGNUP_RSVP, null);
        event("plain-evt", today.plusDays(7), NewsEvent.SIGNUP_NONE, null);
    }

    private void event(String id, LocalDate date, String mode, Integer capacity) {
        var e = new NewsEvent(id, "Evento " + id, date, LocalTime.of(18, 30), LocalTime.of(20, 0), "Aula 1", "meetup");
        e.setOrganization(orgRepo.findById("sabf").orElseThrow());
        e.setSignupMode(mode);
        e.setCapacity(capacity);
        eventRepo.save(e);
    }

    private static RequestPostProcessor as(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", email))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Test
    void createValidatesTheSignupMode() throws Exception {
        mvc.perform(post("/v1/news/events").with(as("alice@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"Charla","eventDate":"%s","startTime":"18:00","endTime":"19:00","location":"Aula 2",
                     "category":"Campus","organization":"sabf","signupMode":"external"}
                    """.formatted(today.plusDays(3))))
            .andExpect(status().isBadRequest());

        mvc.perform(post("/v1/news/events").with(as("alice@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"Charla","eventDate":"%s","startTime":"18:00","endTime":"19:00","location":"Aula 2",
                     "category":"Campus","organization":"sabf","signupMode":"external",
                     "signupUrl":"https://forms.gle/x","capacity":10,"coverImage":"https://img.example/c.png"}
                    """.formatted(today.plusDays(3))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.signupMode").value("external"))
            .andExpect(jsonPath("$.signupUrl").value("https://forms.gle/x"))
            // Capacity only applies to built-in RSVPs.
            .andExpect(jsonPath("$.capacity").doesNotExist())
            .andExpect(jsonPath("$.coverImage").value("https://img.example/c.png"));
    }

    @Test
    void rsvpRespectsCapacityAndIsIdempotent() throws Exception {
        mvc.perform(post("/v1/news/events/rsvp-evt/rsvp").with(as("bob@itba.edu.ar")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.going").value(true))
            .andExpect(jsonPath("$.rsvpCount").value(1));
        mvc.perform(post("/v1/news/events/rsvp-evt/rsvp").with(as("bob@itba.edu.ar")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.rsvpCount").value(1));

        mvc.perform(post("/v1/news/events/rsvp-evt/rsvp").with(as("carol@itba.edu.ar")))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("EventFull"));

        mvc.perform(delete("/v1/news/events/rsvp-evt/rsvp").with(as("bob@itba.edu.ar")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.going").value(false))
            .andExpect(jsonPath("$.rsvpCount").value(0));
        mvc.perform(post("/v1/news/events/rsvp-evt/rsvp").with(as("carol@itba.edu.ar")))
            .andExpect(status().isOk());

        mvc.perform(get("/v1/news/events/rsvp-evt"))
            .andExpect(jsonPath("$.rsvpCount").value(1))
            .andExpect(jsonPath("$.capacity").value(1));
        mvc.perform(get("/v1/me/rsvps").with(as("carol@itba.edu.ar")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.eventIds[0]").value("rsvp-evt"));
    }

    @Test
    void rsvpRefusesPastAndNonRsvpEvents() throws Exception {
        mvc.perform(post("/v1/news/events/past-evt/rsvp").with(as("bob@itba.edu.ar")))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("EventEnded"));
        mvc.perform(post("/v1/news/events/plain-evt/rsvp").with(as("bob@itba.edu.ar")))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("EventNotRsvp"));
        mvc.perform(post("/v1/news/events/rsvp-evt/rsvp")).andExpect(status().isUnauthorized());
    }

    @Test
    void attendeesAreForTheOrgsMembers() throws Exception {
        mvc.perform(post("/v1/news/events/rsvp-evt/rsvp").with(as("bob@itba.edu.ar"))).andExpect(status().isOk());

        mvc.perform(get("/v1/news/events/rsvp-evt/attendees").with(as("alice@itba.edu.ar")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].email").value("bob@itba.edu.ar"));
        mvc.perform(get("/v1/news/events/rsvp-evt/attendees").with(as("bob@itba.edu.ar")))
            .andExpect(status().isForbidden());
    }

    @Test
    void patchReplacesTheSignupOnlyWhenTheModeIsSent() throws Exception {
        mvc.perform(patch("/v1/news/events/rsvp-evt").with(as("alice@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Nuevo título\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.signupMode").value("rsvp"))
            .andExpect(jsonPath("$.capacity").value(1));

        mvc.perform(patch("/v1/news/events/rsvp-evt").with(as("alice@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"signupMode\":\"rsvp\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.capacity").doesNotExist());
    }

    @Test
    void dayBeforeReminderIsClaimedOnce() throws Exception {
        event("tomorrow-evt", today.plusDays(1), NewsEvent.SIGNUP_RSVP, null);
        event("tomorrow-empty", today.plusDays(1), NewsEvent.SIGNUP_RSVP, null);
        mvc.perform(post("/v1/news/events/tomorrow-evt/rsvp").with(as("bob@itba.edu.ar"))).andExpect(status().isOk());

        assertThat(reminders.sendDueReminders()).isEqualTo(1);
        assertThat(reminders.sendDueReminders()).isZero();
        assertThat(eventRepo.findById("tomorrow-evt").orElseThrow().getReminderSentAt()).isNotNull();
        assertThat(eventRepo.findById("rsvp-evt").orElseThrow().getReminderSentAt()).isNull();
        // No RSVPs at the first run: left unclaimed, so a later run reminds a late sign-up.
        assertThat(eventRepo.findById("tomorrow-empty").orElseThrow().getReminderSentAt()).isNull();
        mvc.perform(post("/v1/news/events/tomorrow-empty/rsvp").with(as("bob@itba.edu.ar"))).andExpect(status().isOk());
        assertThat(reminders.sendDueReminders()).isEqualTo(1);

        // Rescheduled after its reminder went out: reminded again for the new date.
        mvc.perform(patch("/v1/news/events/tomorrow-evt").with(as("alice@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"eventDate\":\"%s\"}".formatted(today.plusDays(8))))
            .andExpect(status().isOk());
        assertThat(eventRepo.findById("tomorrow-evt").orElseThrow().getReminderSentAt()).isNull();
    }

    @Test
    void eventViewsAreRecordedWithTheEventId() throws Exception {
        mvc.perform(post("/v1/analytics/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"events\":[{\"type\":\"event_view\",\"sessionId\":\"s1\",\"eventId\":\"rsvp-evt\"}]}"))
            .andExpect(status().isAccepted());
        assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM public.analytics_events WHERE type = 'event_view' AND event_id = 'rsvp-evt'",
            Integer.class)).isEqualTo(1);
    }
}
