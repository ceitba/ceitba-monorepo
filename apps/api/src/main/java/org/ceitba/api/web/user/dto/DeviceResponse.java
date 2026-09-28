package org.ceitba.api.web.user.dto;

import java.time.OffsetDateTime;

public record DeviceResponse(
    String token,
    String platform,
    String appVersion,
    OffsetDateTime createdAt,
    OffsetDateTime lastSeenAt
) {}
