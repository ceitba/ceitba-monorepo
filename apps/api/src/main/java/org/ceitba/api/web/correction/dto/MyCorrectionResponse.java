package org.ceitba.api.web.correction.dto;

import org.ceitba.api.domain.correction.ScheduleCorrectionStatus;
import org.ceitba.api.domain.correction.ScheduleCorrectionVoteType;
import org.ceitba.api.web.subject.dto.OrganizedSubjectsResponse;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

// One of the caller's own suggestions (GET /v1/me/schedule-corrections).
// seen=false means it has been applied and the caller has not dismissed the
// "your correction was applied" notice yet.
public record MyCorrectionResponse(
    UUID id,
    String commissionId,
    ScheduleCorrectionStatus status,
    List<OrganizedSubjectsResponse.Schedule> schedule,
    int confirms,
    int rejects,
    ScheduleCorrectionVoteType myVote,
    Instant createdAt,
    String subjectId,
    String subjectName,
    String commissionName,
    Instant appliedAt,
    boolean seen
) {}
