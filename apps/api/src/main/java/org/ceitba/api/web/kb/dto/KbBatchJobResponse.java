package org.ceitba.api.web.kb.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

// One stage execution. mode: BATCH (a DO batch, doBatchId) | SYNC (chat
// completions). status: DRY (built, not submitted) | SUBMITTED | COMPLETED |
// FAILED | CANCELLED.
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
    String error
) {}
