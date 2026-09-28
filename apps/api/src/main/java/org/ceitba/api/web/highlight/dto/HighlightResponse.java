package org.ceitba.api.web.highlight.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

public record HighlightResponse(
    UUID id,
    String title,
    String description,
    String imageUrl,
    String linkUrl,
    int position,
    OffsetDateTime startsAt,
    OffsetDateTime endsAt,
    boolean active
) {}
