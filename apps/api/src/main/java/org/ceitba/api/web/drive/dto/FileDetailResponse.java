package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

// FileSummary + subject, author, sanitized html (Docs only) and whether the
// caller already reported it.
public record FileDetailResponse(
    UUID id,
    String name,
    String kind,
    String path,
    Long sizeBytes,
    OffsetDateTime driveModifiedAt,
    OffsetDateTime publishedAt,
    boolean hasHtml,
    boolean hasPdf,
    boolean hasOriginal,
    String pdfMimeType,
    String originalMimeType,
    boolean exportBlocked,
    String driveUrl,
    Integer academicYear,
    String academicYearSource,
    String subjectId,
    String subjectName,
    AuthorResponse author,
    String html,
    boolean reportedByMe
) {}
