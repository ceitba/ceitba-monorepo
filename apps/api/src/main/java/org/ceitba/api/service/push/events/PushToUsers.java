package org.ceitba.api.service.push.events;

import org.ceitba.api.service.push.PushMessage;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;

// Push to every device of the given users. See PushTrigger.
public record PushToUsers(Set<UUID> userIds, PushMessage message) implements PushTrigger {

    public PushToUsers {
        userIds = Set.copyOf(userIds);
        Objects.requireNonNull(message, "message");
    }
}
