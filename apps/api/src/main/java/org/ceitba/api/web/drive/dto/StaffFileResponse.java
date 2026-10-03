package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// ownerEmail: the file's Drive owner; sharer*: the student whose source it is.
public record StaffFileResponse(
    UUID id,
    String name,
    String kind,
    UUID sourceId,
    String sourceRootName,
    String ownerEmail,
    String sharerName,
    String sharerEmail,
    String effectiveSubjectId,
    String effectiveSubjectName,
    String publication,
    int reportCount,
    List<StaffReportResponse> reports,
    OffsetDateTime driveModifiedAt
) {}
