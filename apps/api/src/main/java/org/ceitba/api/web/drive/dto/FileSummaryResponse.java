package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

// path: folder path inside the source, e.g. "Comunicación/Trabajo Plasticos"
// ("" for files directly in the shared folder).
// pdfMimeType: "application/pdf" when hasPdf, else null. originalMimeType:
// the Content-Type the original is served with (text-like files:
// "text/plain; charset=utf-8"), null without an original.
// exportBlocked: the owner disabled download for viewers; only driveUrl works.
// driveUrl: opens the file in Google Drive / the Docs editor.
// academicYear: the year the material belongs to; academicYearSource: USER |
// INHERITED | NAME | DRIVE (see docs/DRIVE-SYNC.md).
// community: the file comes from a community archive (author "Comunidad").
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
    boolean hasOriginal,
    String pdfMimeType,
    String originalMimeType,
    boolean exportBlocked,
    String driveUrl,
    Integer academicYear,
    String academicYearSource,
    // From a community archive: show "Comunidad · archivo <academicYear>".
    boolean community
) {}
