package org.ceitba.api.web.studygroup.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.ceitba.api.domain.StudyGroupLocation;
import org.ceitba.api.domain.StudyGroupType;

import java.time.OffsetDateTime;
import java.util.List;

// PATCH /v1/study-groups/{id}. Absent (null) fields are left unchanged.
// A blank description or contactLink clears it; maxParticipants 0 makes the
// group unlimited and can't go below the current member count (409).
// A new dueAt must be in the future.
public record UpdateStudyGroupRequest(
    @Size(min = 1, max = 120) String title,
    @Size(min = 1, max = 25) String subjectId,
    StudyGroupType type,
    @Size(min = 1, max = 4) List<@NotNull StudyGroupLocation> locations,
    OffsetDateTime dueAt,
    @Size(max = 2000) String description,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String contactLink,
    @Min(0) @Max(50) Integer maxParticipants
) {}
