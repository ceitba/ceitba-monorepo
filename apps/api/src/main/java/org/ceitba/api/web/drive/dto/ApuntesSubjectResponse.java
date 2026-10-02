package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;

public record ApuntesSubjectResponse(String subjectId, String subjectName, long fileCount,
                                     OffsetDateTime lastUpdatedAt) {}
