package org.ceitba.api.service.drive;

import org.ceitba.api.external.drive.DriveItem;

import java.util.Locale;
import java.util.Set;

// How stored copies are served, and links back to Drive.
//
// Stored objects sit in the media bucket, which in prod is served from the
// site's own origin (ceitba.org.ar/ceitba-media), so only types that cannot
// run script there are served inline: PDF, raster images and text-like files
// (as text/plain; charset=utf-8). Everything else (Office files, SVG, HTML,
// archives, ...) is always an attachment.
public final class DriveMedia {

    public static final String PDF = "application/pdf";
    public static final String TEXT = "text/plain; charset=utf-8";

    private static final Set<String> INLINE_IMAGES =
        Set.of("image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp");
    private static final Set<String> TEXT_MIMES = Set.of(
        "application/json", "application/x-ipynb+json", "application/vnd.google.colaboratory",
        "application/x-yaml", "application/yaml", "application/sql", "application/x-sh",
        "application/javascript", "application/x-python-code");
    private static final Set<String> TEXT_EXTENSIONS = Set.of(
        "txt", "md", "markdown", "csv", "tsv", "json", "ipynb", "yaml", "yml", "toml", "ini", "log",
        "py", "java", "kt", "c", "h", "cpp", "hpp", "cc", "cs", "go", "rs", "js", "ts", "jsx", "tsx",
        "sql", "sh", "r", "m", "rb", "php", "swift", "scala", "hs", "pl", "lua", "asm", "s", "vhd", "vhdl",
        "tex", "bib", "dart", "gradle");
    // Text that a browser would render as a document if served with its own type.
    private static final Set<String> ACTIVE_TEXT = Set.of("text/html", "text/xml", "image/svg+xml",
        "application/xhtml+xml", "application/xml");

    private DriveMedia() {}

    // Source code, notebooks, CSV, Markdown, JSON...: stored and shown as text.
    public static boolean isTextLike(String mimeType, String name) {
        var mime = base(mimeType);
        if (ACTIVE_TEXT.contains(mime)) return false;
        if (mime.startsWith("text/") || TEXT_MIMES.contains(mime)) return true;
        return TEXT_EXTENSIONS.contains(extension(name));
    }

    // The Content-Type the original is served with when shown inline, or null
    // when it must be downloaded.
    public static String inlineType(String storedType, String name) {
        var mime = base(storedType);
        if (PDF.equals(mime) || INLINE_IMAGES.contains(mime)) return mime;
        if (isTextLike(storedType, name)) return TEXT;
        return null;
    }

    // What FileSummary.originalMimeType reports: the inline type when there
    // is one, else the stored type.
    public static String servedType(String storedType, String name) {
        if (storedType == null) return null;
        var inline = inlineType(storedType, name);
        return inline != null ? inline : storedType;
    }

    // Opens the item in Google Drive (the editor for native files).
    public static String driveUrl(String driveId, String mimeType) {
        if (driveId == null) return null;
        return switch (mimeType == null ? "" : mimeType) {
            case "application/vnd.google-apps.document" -> "https://docs.google.com/document/d/" + driveId + "/edit";
            case "application/vnd.google-apps.spreadsheet" -> "https://docs.google.com/spreadsheets/d/" + driveId + "/edit";
            case "application/vnd.google-apps.presentation" -> "https://docs.google.com/presentation/d/" + driveId + "/edit";
            case "application/vnd.google-apps.drawing" -> "https://docs.google.com/drawings/d/" + driveId + "/edit";
            case DriveItem.FOLDER_MIME -> "https://drive.google.com/drive/folders/" + driveId;
            default -> "https://drive.google.com/file/d/" + driveId + "/view";
        };
    }

    private static String base(String mimeType) {
        if (mimeType == null) return "";
        int semi = mimeType.indexOf(';');
        return (semi >= 0 ? mimeType.substring(0, semi) : mimeType).trim().toLowerCase(Locale.ROOT);
    }

    private static String extension(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }
}
