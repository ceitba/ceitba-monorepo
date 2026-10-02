package org.ceitba.api.web.correction.dto;

import org.ceitba.api.domain.correction.ScheduleCorrectionStatus;
import org.ceitba.api.domain.correction.ScheduleCorrectionVoteType;
import org.ceitba.api.web.subject.dto.OrganizedSubjectsResponse;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

// Public view of a schedule correction. Never carries the suggester or the
// voters; myVote is the caller's own vote (null when they have none).
// `schedule` entries keep the snake_case slot shape of GET /v1/subjects.
public record CorrectionResponse(
    UUID id,
    String commissionId,
    ScheduleCorrectionStatus status,
    List<OrganizedSubjectsResponse.Schedule> schedule,
    int confirms,
    int rejects,
    ScheduleCorrectionVoteType myVote,
    Instant createdAt
) {}
