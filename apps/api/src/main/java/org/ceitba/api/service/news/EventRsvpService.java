package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.EventRsvp;
import org.ceitba.api.domain.news.EventRsvpId;
import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.EventRsvpRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

// Built-in event sign-up (signup_mode 'rsvp', docs/ORGANIZATIONS.md). Going
// is idempotent; the capacity check runs under the event's row lock, so two
// last-seat RSVPs serialize and the second one gets 409 EventFull.
@Service
public class EventRsvpService {

    private final EventRsvpRepository rsvps;
    private final NewsEventRepository events;
    private final UserRepository users;
    private final Clock clock;

    public EventRsvpService(EventRsvpRepository rsvps, NewsEventRepository events, UserRepository users, Clock clock) {
        this.rsvps = rsvps;
        this.events = events;
        this.users = users;
        this.clock = clock;
    }

    public record Attendee(UUID userId, String name, String email, OffsetDateTime createdAt) {}

    @Transactional
    public long rsvp(String eventId, UUID userId) {
        var event = events.findByIdForUpdate(eventId)
            .orElseThrow(() -> new ResourceNotFoundException("Event", eventId));
        if (!NewsEvent.SIGNUP_RSVP.equals(event.getSignupMode())) {
            throw new EventRsvpException(EventRsvpException.Reason.NOT_RSVP);
        }
        if (event.getEventDate().isBefore(LocalDate.now(clock))) {
            throw new EventRsvpException(EventRsvpException.Reason.ENDED);
        }
        if (rsvps.existsByEventIdAndUserId(eventId, userId)) return rsvps.countByEventId(eventId);
        long going = rsvps.countByEventId(eventId);
        if (event.getCapacity() != null && going >= event.getCapacity()) {
            throw new EventRsvpException(EventRsvpException.Reason.FULL);
        }
        rsvps.save(new EventRsvp(eventId, userId));
        return going + 1;
    }

    // Idempotent; also allowed after the event changed its sign-up mode.
    @Transactional
    public long cancel(String eventId, UUID userId) {
        if (!events.existsById(eventId)) throw new ResourceNotFoundException("Event", eventId);
        rsvps.deleteByEventIdAndUserId(eventId, userId);
        return rsvps.countByEventId(eventId);
    }

    @Transactional(readOnly = true)
    public boolean isGoing(String eventId, UUID userId) {
        return rsvps.existsById(new EventRsvpId(eventId, userId));
    }

    @Transactional(readOnly = true)
    public List<String> eventIdsOf(UUID userId) {
        return rsvps.findEventIdsByUserId(userId);
    }

    @Transactional(readOnly = true)
    public List<Attendee> attendees(String eventId) {
        if (!events.existsById(eventId)) throw new ResourceNotFoundException("Event", eventId);
        var list = rsvps.findByEventIdOrderByCreatedAt(eventId);
        Map<UUID, User> byId = users.findAllById(list.stream().map(EventRsvp::getUserId).toList()).stream()
            .collect(Collectors.toMap(User::getId, Function.identity()));
        return list.stream()
            .map(r -> {
                var u = byId.get(r.getUserId());
                return new Attendee(r.getUserId(), u != null ? u.getName() : null, u != null ? u.getEmail() : null,
                    r.getCreatedAt());
            })
            .toList();
    }

    // RSVP count per event id; events without RSVPs are absent.
    @Transactional(readOnly = true)
    public Map<String, Long> counts(Collection<String> eventIds) {
        var out = new HashMap<String, Long>();
        if (eventIds.isEmpty()) return out;
        for (var row : rsvps.countByEventIds(eventIds)) out.put((String) row[0], (Long) row[1]);
        return out;
    }
}
