package org.ceitba.api.service.drive;

import org.ceitba.api.domain.drive.DriveFileKind;
import org.ceitba.api.external.drive.DriveItem;

import java.util.Optional;
import java.util.Set;

// Drive mimeType -> DriveFileKind; empty for items the sync skips entirely
// (no row, no download, not counted): forms, sites, maps, Apps Script, and
// anything the wiki pipeline cannot read (video, audio, archives,
// executables, CAD, ...). OTHER is only kept for text-like files (code,
// notebooks, CSV, Markdown, JSON: DriveMedia.isTextLike), which are
// extracted as text. Images are kept for student sources (photos of notes)
// and skipped in community sources (allowImages false).
public final class DriveKinds {

    private static final Set<String> OFFICE = Set.of(
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.oasis.opendocument.text",
        "application/vnd.oasis.opendocument.presentation",
        "application/vnd.oasis.opendocument.spreadsheet",
        "application/rtf",
        "text/plain",
        "text/csv",
        "text/markdown");

    private DriveKinds() {}

    public static Optional<DriveFileKind> of(String mimeType, String name, boolean allowImages) {
        if (mimeType == null) return textLike(null, name);
        return switch (mimeType) {
            case DriveItem.FOLDER_MIME -> Optional.of(DriveFileKind.FOLDER);
            case "application/vnd.google-apps.document" -> Optional.of(DriveFileKind.DOC);
            case "application/vnd.google-apps.presentation" -> Optional.of(DriveFileKind.SLIDES);
            case "application/vnd.google-apps.spreadsheet" -> Optional.of(DriveFileKind.SHEET);
            case "application/vnd.google-apps.drawing" -> Optional.of(DriveFileKind.DRAWING);
            case "application/pdf" -> Optional.of(DriveFileKind.PDF);
            default -> {
                if (mimeType.startsWith("application/vnd.google-apps.")) yield Optional.empty();
                if (mimeType.startsWith("image/")) {
                    yield allowImages ? Optional.of(DriveFileKind.IMAGE) : Optional.empty();
                }
                if (OFFICE.contains(mimeType)) yield Optional.of(DriveFileKind.OFFICE);
                yield textLike(mimeType, name);
            }
        };
    }

    private static Optional<DriveFileKind> textLike(String mimeType, String name) {
        return DriveMedia.isTextLike(mimeType, name) ? Optional.of(DriveFileKind.OTHER) : Optional.empty();
    }
}
