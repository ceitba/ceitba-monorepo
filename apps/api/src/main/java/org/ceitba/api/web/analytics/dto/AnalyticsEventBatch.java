package org.ceitba.api.web.analytics.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record AnalyticsEventBatch(
    @NotNull
    @Size(min = 1, max = 50, message = "Batch must contain between 1 and 50 events")
    @Valid
    List<EventDto> events
) {
    public record EventDto(
        @NotNull String type,
        @NotNull String sessionId,
        Long   timestamp,
        String articleId,
        @Size(max = 64) String eventId,
        String category,
        String path
    ) {}
}
