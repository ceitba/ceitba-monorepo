package org.ceitba.api.domain.news;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// A user going to an event with built-in sign-up (V56, signup_mode 'rsvp').
@Entity
@Table(schema = "public", name = "event_rsvps")
@IdClass(EventRsvpId.class)
public class EventRsvp {

    @Id
    @Column(name = "event_id")
    private String eventId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected EventRsvp() {}

    public EventRsvp(String eventId, UUID userId) {
        this.eventId = eventId;
        this.userId = userId;
    }

    public String getEventId()           { return eventId; }
    public UUID getUserId()              { return userId; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
