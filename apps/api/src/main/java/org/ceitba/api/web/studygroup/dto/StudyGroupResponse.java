package org.ceitba.api.web.studygroup.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.ceitba.api.domain.StudyGroupLocation;
import org.ceitba.api.domain.StudyGroupType;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// One study group as seen by the requesting user.
//
// * maxParticipants: null = unlimited; it counts the owner.
// * contactLink: only filled in for members, null for everyone else.
// * participants: only on single-group responses (GET /{id}, create, patch,
//   join); omitted from list pages, which carry participantCount instead.
// * isMember / isOwner / canEdit are relative to the caller; canEdit is true
//   for the owner and for moderators.
public record StudyGroupResponse(
    UUID id,
    String title,
    StudyGroupSubjectResponse subject,
    StudyGroupType type,
    List<StudyGroupLocation> locations,
    OffsetDateTime dueAt,
    String description,
    String contactLink,
    Integer maxParticipants,
    long participantCount,
    @JsonProperty("isFull") boolean isFull,
    @JsonProperty("isMember") boolean isMember,
    @JsonProperty("isOwner") boolean isOwner,
    boolean canEdit,
    @JsonInclude(JsonInclude.Include.NON_NULL) List<StudyGroupParticipantResponse> participants,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
