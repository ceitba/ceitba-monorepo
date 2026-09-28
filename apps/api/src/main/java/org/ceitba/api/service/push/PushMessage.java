package org.ceitba.api.service.push;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

// One notification as shown on the device, plus the data payload the app uses
// to deep-link. By convention `data` carries "type" (what was published, e.g.
// "article", "event", "proposal") and "id" (its API id); see forResource.
// FCM data values must be strings.
public record PushMessage(String title, String body, Map<String, String> data) {

    public static final String TYPE = "type";
    public static final String ID   = "id";

    public PushMessage {
        if (title == null || title.isBlank()) throw new IllegalArgumentException("title is required");
        if (body == null || body.isBlank())   throw new IllegalArgumentException("body is required");
        var copy = new LinkedHashMap<String, String>();
        if (data != null) {
            data.forEach((k, v) -> {
                Objects.requireNonNull(k, "data key");
                if (v != null) copy.put(k, v);
            });
        }
        data = Map.copyOf(copy);
    }

    public static PushMessage forResource(String title, String body, String type, String id) {
        return new PushMessage(title, body, Map.of(TYPE, type, ID, id));
    }
}
