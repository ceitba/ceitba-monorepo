package org.ceitba.api.web.kb.admin;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.math.BigDecimal;

// One group of GET /costs (ADMIN doc §3, §6). key: the group's value (single
// dimension, e.g. "glm-5.3") or the values joined with "|" in groupBy order
// (e.g. "2026-09-28|WRITE"). Only the requested dimensions are present:
// week (ISO date of the Monday, Buenos Aires), stage, model, subjectId.
@JsonInclude(JsonInclude.Include.NON_NULL)
public record KbCostRowResponse(String key, String week, String stage, String model, String subjectId, long inputTokens,
                                long cachedInputTokens, long outputTokens, BigDecimal costUsd, long requests) {}
