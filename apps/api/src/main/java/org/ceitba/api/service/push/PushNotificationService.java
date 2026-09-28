package org.ceitba.api.service.push;

import java.util.Collection;
import java.util.UUID;

// Sends a push notification to every registered device (user_devices) of the
// selected users. Calls are synchronous and do network I/O: feature code
// should not call this directly inside a request, but publish a
// org.ceitba.api.service.push.events.PushTrigger event instead, which is
// delivered after commit on a background thread (PushTriggerListener).
//
// Implementations: FcmPushNotificationService when Firebase is configured,
// NoOpPushNotificationService otherwise (local dev, tests).
public interface PushNotificationService {

    PushResult sendToUsers(Collection<UUID> userIds, PushMessage message);

    // Users following the organization (public.user_follows).
    PushResult sendToOrgFollowers(String orgSlug, PushMessage message);

    // Every registered device.
    PushResult broadcast(PushMessage message);
}
