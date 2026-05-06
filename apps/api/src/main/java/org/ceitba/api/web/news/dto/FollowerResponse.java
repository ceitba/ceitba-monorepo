package org.ceitba.api.web.news.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

public record FollowerResponse(
    UUID           userId,
    String         name,
    String         email,
    String         avatarUrl,
    OffsetDateTime followedAt
) {}
