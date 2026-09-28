package org.ceitba.api.service.push;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collection;
import java.util.UUID;

// Used when no Firebase service account is configured: pushes are logged at
// DEBUG and dropped, so local dev and tests never reach FCM.
public class NoOpPushNotificationService implements PushNotificationService {

    private static final Logger log = LoggerFactory.getLogger(NoOpPushNotificationService.class);

    @Override
    public PushResult sendToUsers(Collection<UUID> userIds, PushMessage message) {
        log.debug("Push disabled; dropping message to {} users: {}", userIds.size(), message.title());
        return PushResult.NONE;
    }

    @Override
    public PushResult sendToOrgFollowers(String orgSlug, PushMessage message) {
        log.debug("Push disabled; dropping message to followers of {}: {}", orgSlug, message.title());
        return PushResult.NONE;
    }

    @Override
    public PushResult broadcast(PushMessage message) {
        log.debug("Push disabled; dropping broadcast: {}", message.title());
        return PushResult.NONE;
    }
}
