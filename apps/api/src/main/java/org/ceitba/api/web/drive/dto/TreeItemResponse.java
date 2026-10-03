package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

// One item of a source's flat tree. parentId is another item's id, or null
// for direct children of the shared folder. suggestedInMyPlan /
// effectiveInMyPlan: whether that subject is in the student's plan (false
// when null or without a plan). A child without its own suggestion inherits
// its folder's (shown on the folder only).
public record TreeItemResponse(
    UUID id,
    UUID parentId,
    String name,
    String kind,
    String subjectId,
    String subjectName,
    String effectiveSubjectId,
    String effectiveSubjectName,
    String suggestedSubjectId,
    String suggestedSubjectName,
    boolean suggestedInMyPlan,
    boolean effectiveInMyPlan,
    boolean hidden,
    String publication,
    boolean ownedByMe,
    Long sizeBytes,
    OffsetDateTime driveModifiedAt,
    String syncError,
    boolean exportBlocked,
    String driveUrl
) {}
