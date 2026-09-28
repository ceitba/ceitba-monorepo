package org.ceitba.api.service.push.events;

import org.ceitba.api.service.push.PushMessage;

import java.util.Objects;

// Push to every registered device. STAFF-only in the API
// (POST /v1/staff/push/broadcast). See PushTrigger.
public record PushBroadcast(PushMessage message) implements PushTrigger {

    public PushBroadcast {
        Objects.requireNonNull(message, "message");
    }
}
