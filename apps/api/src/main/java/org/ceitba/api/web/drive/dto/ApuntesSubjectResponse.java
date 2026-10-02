package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;

// year/semester: the subject's place in the caller's plan (only with
// ?mine=true; null otherwise).
public record ApuntesSubjectResponse(String subjectId, String subjectName, long fileCount,
                                     OffsetDateTime lastUpdatedAt, Integer year, Integer semester) {}
