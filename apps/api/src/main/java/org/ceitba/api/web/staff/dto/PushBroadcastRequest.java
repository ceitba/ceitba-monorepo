package org.ceitba.api.web.staff.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.Map;

// POST /v1/staff/push/broadcast. `data` is optional; by convention it carries
// "type" and "id" so the app can deep-link. Sizes keep the whole FCM payload
// under its 4 KB limit.
public record PushBroadcastRequest(
    @NotBlank @Size(max = 200)  String title,
    @NotBlank @Size(max = 1000) String body,
    @Size(max = 10) Map<String, String> data
) {}
