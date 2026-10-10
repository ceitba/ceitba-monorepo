package org.ceitba.api.domain.news;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class EventRsvpId implements Serializable {

    private String eventId;
    private UUID userId;

    public EventRsvpId() {}

    public EventRsvpId(String eventId, UUID userId) {
        this.eventId = eventId;
        this.userId = userId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof EventRsvpId other)) return false;
        return Objects.equals(eventId, other.eventId) && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(eventId, userId);
    }
}
