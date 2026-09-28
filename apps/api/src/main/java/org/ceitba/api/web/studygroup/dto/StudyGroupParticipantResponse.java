package org.ceitba.api.web.studygroup.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;

// Public view of a member: display name and avatar only. Never the email or
// any other contact detail; members coordinate through the group's contactLink.
public record StudyGroupParticipantResponse(
    String name,
    String avatarUrl,
    @JsonProperty("isOwner") boolean isOwner,
    OffsetDateTime joinedAt
) {}
