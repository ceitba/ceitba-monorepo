package org.ceitba.api.web.staff.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ModeratorResponse(
    UUID userId,
    String email,
    String name,
    UUID grantedBy,
    OffsetDateTime grantedAt
) {}
