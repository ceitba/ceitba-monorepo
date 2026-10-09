package org.ceitba.api.service.news;

import org.ceitba.api.repository.news.EventRsvpRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.service.push.PushMessage;
import org.ceitba.api.service.push.events.PushToUsers;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.HashSet;

// Day-before push to the people going to an RSVP event (EventReminderJob).
// Each event is claimed with a conditional UPDATE of reminder_sent_at, so
// re-runs and overlapping runs send it at most once. Reaches the RSVPs'
// mobile devices; web-only users get nothing.
@Service
public class EventReminderService {

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");

    private final NewsEventRepository events;
    private final EventRsvpRepository rsvps;
    private final ApplicationEventPublisher publisher;
    private final Clock clock;

    public EventReminderService(NewsEventRepository events, EventRsvpRepository rsvps,
                                ApplicationEventPublisher publisher, Clock clock) {
        this.events = events;
        this.rsvps = rsvps;
        this.publisher = publisher;
        this.clock = clock;
    }

    // Number of events whose reminder this call sent.
    @Transactional
    public int sendDueReminders() {
        var tomorrow = LocalDate.now(clock).plusDays(1);
        var now = OffsetDateTime.now(clock);
        int sent = 0;
        for (var id : events.findReminderDue(tomorrow)) {
            // No RSVPs yet: left unclaimed, so a later run reminds whoever signs up this evening.
            var users = new HashSet<>(rsvps.findUserIdsByEventId(id));
            if (users.isEmpty()) continue;
            if (events.claimReminder(id, now) != 1) continue;
            var event = events.findById(id).orElseThrow();
            var body = "Mañana a las " + event.getStartTime().format(TIME) + " · " + event.getLocation();
            var data = new HashMap<String, String>();
            data.put(PushMessage.TYPE, "event");
            data.put(PushMessage.ID, id);
            if (event.getOrganization() != null) data.put("org", event.getOrganization().getSlug());
            publisher.publishEvent(new PushToUsers(users, new PushMessage(event.getTitle(), body, data)));
            sent++;
        }
        return sent;
    }
}
