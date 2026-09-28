package org.ceitba.api.web.studygroup.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.ceitba.api.domain.StudyGroupLocation;
import org.ceitba.api.domain.StudyGroupType;

import java.time.OffsetDateTime;
import java.util.List;

// POST /v1/study-groups. dueAt must be in the future. maxParticipants counts
// the owner; null or 0 means unlimited, otherwise 2..50. subjectId must be a
// known subject id (e.g. "93.41").
public record CreateStudyGroupRequest(
    @NotBlank @Size(max = 120) String title,
    @NotBlank @Size(max = 25) String subjectId,
    @NotNull StudyGroupType type,
    @NotEmpty @Size(max = 4) List<@NotNull StudyGroupLocation> locations,
    @NotNull OffsetDateTime dueAt,
    @Size(max = 2000) String description,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String contactLink,
    @Min(0) @Max(50) Integer maxParticipants
) {}
