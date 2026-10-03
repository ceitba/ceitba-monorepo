package org.ceitba.api.web.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

// settings: every field with its effective value; source: env | db per
// field; costImpact only on PUT/restore/preview: the weekly forecast with the
// previous vs the new settings.
public record KbSettingsResponse(JsonNode settings, JsonNode source, OffsetDateTime updatedAt, UUID updatedBy,
                                 String updatedByName, CostImpact costImpact) {

    // previous/projected: the forecast's weekly expectation (ADMIN doc §7)
    // with the current and the new settings; *WeeklyAvgUsd: their expectedUsd.
    public record CostImpact(KbForecastResponse.Weekly previous, KbForecastResponse.Weekly projected) {}
}
