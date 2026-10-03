package org.ceitba.api.web.kb.admin;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.math.BigDecimal;

// One group of GET /costs (ADMIN doc §6). Only the requested dimensions are
// present: week (ISO date of the Monday, Buenos Aires), stage, model, subjectId.
@JsonInclude(JsonInclude.Include.NON_NULL)
public record KbCostRowResponse(String week, String stage, String model, String subjectId, long inputTokens,
                                long cachedInputTokens, long outputTokens, BigDecimal costUsd, long requests) {}
