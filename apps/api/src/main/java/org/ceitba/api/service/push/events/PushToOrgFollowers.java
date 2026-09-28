package org.ceitba.api.service.push.events;

import org.ceitba.api.service.push.PushMessage;

import java.util.Objects;

// Push to every device of the users following an organization
// (public.user_follows). See PushTrigger.
public record PushToOrgFollowers(String orgSlug, PushMessage message) implements PushTrigger {

    public PushToOrgFollowers {
        Objects.requireNonNull(orgSlug, "orgSlug");
        Objects.requireNonNull(message, "message");
    }
}
