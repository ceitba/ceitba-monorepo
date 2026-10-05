package org.ceitba.api.web.kb.dto;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

// status: PENDING | DEFERRED (over budget, stays dirty) | FAILED (stays dirty)
// | PUBLISHED | DRY | CANCELLED. operations: the validated PLAN; rejected:
// [{slug, errors}] pages that kept their previous version.
public record KbRunSubjectResponse(
    String subjectId,
    String subjectName,
    String status,
    String model,
    List<String> added,
    List<String> changed,
    List<String> removed,
    JsonNode operations,
    JsonNode accepted,
    JsonNode rejected,
    JsonNode deleted,
    long tokensIn,
    long tokensOut,
    long tokensCached,
    java.math.BigDecimal costEstimate,
    java.math.BigDecimal costUsd,
    String error,
    // {proposed, kept, dropped: {reason: count}} when PLAN dropped operations, else null.
    JsonNode droppedPlanOps,
    // Files left out of this run (no digest); they are retried next run.
    int skippedFiles
) {}
