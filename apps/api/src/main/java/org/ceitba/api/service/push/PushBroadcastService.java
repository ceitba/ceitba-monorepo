package org.ceitba.api.service.push;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.service.push.events.PushBroadcast;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

// STAFF broadcast to every registered device (POST /v1/staff/push/broadcast).
// Only queues the push (PushBroadcast event); delivery is asynchronous.
@Service
public class PushBroadcastService {

    private static final Logger log = LoggerFactory.getLogger(PushBroadcastService.class);

    static final int MAX_KEY_LENGTH   = 64;
    static final int MAX_VALUE_LENGTH = 200;
    // FCM rejects these data keys (INVALID_ARGUMENT for every token).
    private static final Set<String> RESERVED_KEYS = Set.of("from", "notification", "message_type", "collapse_key");

    private final ApplicationEventPublisher events;

    public PushBroadcastService(ApplicationEventPublisher events) {
        this.events = events;
    }

    public void broadcast(String title, String body, Map<String, String> data, UUID requestedBy) {
        if (data != null) data.forEach(PushBroadcastService::validateEntry);
        var message = new PushMessage(title.trim(), body.trim(), data);
        log.info("Push broadcast queued by {}: '{}'", requestedBy, message.title());
        events.publishEvent(new PushBroadcast(message));
    }

    private static void validateEntry(String key, String value) {
        if (key == null || key.isBlank() || key.length() > MAX_KEY_LENGTH) {
            throw new ValidationException("data", key, "keys must be 1-" + MAX_KEY_LENGTH + " characters");
        }
        var lower = key.toLowerCase(Locale.ROOT);
        if (RESERVED_KEYS.contains(lower) || lower.startsWith("google.") || lower.startsWith("gcm.")) {
            throw new ValidationException("data", key, "reserved by FCM");
        }
        if (value != null && value.length() > MAX_VALUE_LENGTH) {
            throw new ValidationException("data." + key, value.length() + " characters", "values must be at most " + MAX_VALUE_LENGTH + " characters");
        }
    }
}
