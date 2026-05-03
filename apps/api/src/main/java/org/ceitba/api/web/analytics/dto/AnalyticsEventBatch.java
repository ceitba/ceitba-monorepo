package org.ceitba.api.web.analytics.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record AnalyticsEventBatch(
    @NotNull
    @Size(max = 50, message = "Batch may contain at most 50 events")
    @Valid
    List<EventDto> events
) {
    public record EventDto(
        @NotNull String type,
        @NotNull String sessionId,
        Long   timestamp,
        String articleId,
        String category,
        String path
    ) {}
}
