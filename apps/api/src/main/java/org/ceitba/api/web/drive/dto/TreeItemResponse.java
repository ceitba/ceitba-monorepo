package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

// One item of a source's flat tree. parentId is another item's id, or null
// for direct children of the shared folder.
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
    boolean hidden,
    String publication,
    boolean ownedByMe,
    Long sizeBytes,
    OffsetDateTime driveModifiedAt,
    String syncError
) {}
