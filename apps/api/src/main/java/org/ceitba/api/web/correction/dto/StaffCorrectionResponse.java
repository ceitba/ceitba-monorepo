package org.ceitba.api.web.correction.dto;

import org.ceitba.api.domain.correction.ScheduleCorrectionStatus;
import org.ceitba.api.web.subject.dto.OrganizedSubjectsResponse;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

// Staff view. Still anonymous: no suggester, no voters, no reviewer.
// sgaSchedule is the commission's current SGA slots.
public record StaffCorrectionResponse(
    UUID id,
    String commissionId,
    ScheduleCorrectionStatus status,
    List<OrganizedSubjectsResponse.Schedule> schedule,
    int confirms,
    int rejects,
    Instant createdAt,
    String subjectId,
    String subjectName,
    String commissionName,
    List<OrganizedSubjectsResponse.Schedule> sgaSchedule,
    Instant appliedAt,
    Instant reviewedAt,
    boolean reviewedByStaff
) {}
