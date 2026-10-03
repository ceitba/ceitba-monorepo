package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;

// Only with ?mine=true (null otherwise): year/semester = the subject's place
// in the caller's plan (null for electives and other year-0 entries);
// section = its plan_subject section (e.g. "Electivas Analytics").
// hasWiki: the subject wiki has at least one PUBLISHED page.
public record ApuntesSubjectResponse(String subjectId, String subjectName, long fileCount,
                                     OffsetDateTime lastUpdatedAt, Integer year, Integer semester,
                                     String section, boolean hasWiki) {

    public ApuntesSubjectResponse withWiki(boolean hasWiki) {
        return new ApuntesSubjectResponse(subjectId, subjectName, fileCount, lastUpdatedAt, year, semester, section,
            hasWiki);
    }
}
