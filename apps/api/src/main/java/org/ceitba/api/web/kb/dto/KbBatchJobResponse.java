package org.ceitba.api.web.kb.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

// One stage execution. mode: BATCH (a DO batch, doBatchId) | SYNC (chat
// completions). status: DRY (built, not submitted) | QUEUED (created before
// DO was called; while DO rate-limits creation, retried at nextAttemptAt) |
// SUBMITTED | COMPLETED | FAILED | CANCELLED. error: DO's error_message of a
// failed batch, or why a QUEUED creation is being retried.
// payloadKey/outputKey: the JSONL in object storage (kb/runs/<runId>/...).
public record KbBatchJobResponse(
    UUID id,
    String stage,
    int attempt,
    String model,
    String mode,
    String status,
    int requestCount,
    String doBatchId,
    String payloadKey,
    String outputKey,
    long tokensIn,
    long tokensOut,
    long tokensCached,
    java.math.BigDecimal costEstimate,
    java.math.BigDecimal costUsd,
    OffsetDateTime submittedAt,
    OffsetDateTime completedAt,
    String error,
    OffsetDateTime nextAttemptAt
) {}
