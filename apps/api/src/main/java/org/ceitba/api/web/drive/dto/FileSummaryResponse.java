package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

// path: folder path inside the source, e.g. "Comunicación/Trabajo Plasticos"
// ("" for files directly in the shared folder).
public record FileSummaryResponse(
    UUID id,
    String name,
    String kind,
    String path,
    Long sizeBytes,
    OffsetDateTime driveModifiedAt,
    OffsetDateTime publishedAt,
    boolean hasHtml,
    boolean hasPdf,
    boolean hasOriginal
) {}
