package org.ceitba.api.service.drive;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.ceitba.api.config.DriveSyncProperties;
import org.ceitba.api.domain.drive.DriveFileKind;
import org.ceitba.api.external.drive.DriveApiException;
import org.ceitba.api.external.drive.DriveClient;
import org.ceitba.api.service.media.ObjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.zip.ZipInputStream;

// Fetches one Drive file and stores our copy (docs/DRIVE-SYNC.md):
//
//   DOC            export application/zip (HTML + images): images -> storage,
//                  <img src> rewritten to /api/v1/wiki/files/{id}/assets/{name},
//                  HTML sanitized (DocHtmlSanitizer) and kept in the row;
//                  plus export application/pdf. "Export too large" -> PDF only.
//   SLIDES, SHEET  export application/pdf
//   DRAWING        export image/png (original)
//   PDF            download (original, also served as the pdf variant)
//   IMAGE, OFFICE  download (original)
//   OTHER, or over DRIVE_SYNC_MAX_FILE_BYTES: metadata only (OTHER is only
//                  text-like files, stored as text; DriveKinds skips the rest,
//                  so videos, audio and archives are never downloaded)
//
// Request.reference (REFERENCE sources, files above
// DRIVE_SYNC_REFERENCE_ABOVE_BYTES): nothing is uploaded. Only what the wiki
// and search need is kept: text (PDFs, Slides/Sheets exports, text-like
// files: downloaded/exported to a temp file, read, deleted) and Docs'
// sanitized HTML without its images. Images, Office files and Drawings are
// not downloaded at all, Docs are not exported to PDF. Downloads stream from
// Drive on request (DriveStreamer). The fingerprint gets the "ref:" prefix.
//
// Content fingerprint: md5Checksum for binary files (known before
// downloading). Native Google files have none (modifiedTime also moves on
// renames, and the bot cannot read revisions), so they are exported and
// hashed: Docs = sanitized HTML + image bytes, Slides/Sheets = PDF text +
// page count (PDF bytes carry timestamps), Drawings = PNG bytes. When
// `haveCopy` already knows that fingerprint (this row's current copy, or
// another row's) nothing is uploaded and Content.existing is returned.
//
// Text for search (jsoup for HTML, PDFBox for PDF), capped at 1 MB, goes to
// text_content. Keys: drive/<driveId>/<fingerprint hash>/<name> (DriveBlobs),
// shared by every row with the same content. Bytes are spooled to temp files
// (never more than one file's worth in memory). If a step fails, objects
// already written for this copy are deleted.
@Component
public class DriveContentProcessor {

    private static final Logger log = LoggerFactory.getLogger(DriveContentProcessor.class);

    static final int MAX_TEXT_CHARS = 1_000_000;
    static final int MAX_HTML_CHARS = 2_000_000;
    static final int MAX_ASSETS = 200;

    // Asset URLs are hashed with this neutral file id and rewritten to the
    // row's id afterwards, so identical Docs hash identically.
    static final String NEUTRAL_FILE = "__FILE__";

    private final DriveClient drive;
    private final ObjectStorage storage;
    private final DriveSyncProperties props;

    public DriveContentProcessor(DriveClient drive, ObjectStorage storage, DriveSyncProperties props) {
        this.drive = drive;
        this.storage = storage;
        this.props = props;
    }

    // knownFingerprint: the binary fingerprint (md5) when Drive gave one.
    public record Request(UUID fileId, String driveId, DriveFileKind kind, String name,
                          String mimeType, Long version, String knownFingerprint, Long size, boolean reference) {}

    // existing = a copy with this fingerprint is already stored: no keys here.
    // exportBlocked = the owner disabled download/export (metadata only).
    // byReference = nothing stored (see the class comment).
    public record Content(Long version, String fingerprint, String html, String pdfKey, String originalKey,
                          String originalContentType, String assetPrefix, List<String> assetNames,
                          String text, boolean metadataOnly, boolean existing, boolean exportBlocked,
                          boolean byReference) {

        Content(Long version, String fingerprint, String html, String pdfKey, String originalKey,
                String originalContentType, String assetPrefix, List<String> assetNames, String text,
                boolean metadataOnly, boolean existing) {
            this(version, fingerprint, html, pdfKey, originalKey, originalContentType, assetPrefix, assetNames,
                text, metadataOnly, existing, false, false);
        }

        Content asReference() {
            return new Content(version, DriveSyncStore.REF + fingerprint, html, null, null, originalContentType,
                null, List.of(), text, metadataOnly, existing, exportBlocked, true);
        }

        static Content metadataOnly(Request r) {
            return new Content(r.version(), metaFingerprint(r), null, null, null, null, null, List.of(), null,
                true, false);
        }

        // Not the md5: nothing is stored, so it must never pass for a copy.
        static Content blocked(Request r) {
            return new Content(r.version(), "blocked:" + (r.version() == null ? 0 : r.version()), null, null, null, null, null, List.of(), null,
                true, false, true, false);
        }

        private static String metaFingerprint(Request r) {
            return r.knownFingerprint() != null ? r.knownFingerprint()
                : "meta:" + (r.version() == null ? 0 : r.version()) + ":" + r.size();
        }

        static Content existing(Request r, String fingerprint) {
            return new Content(r.version(), fingerprint, null, null, null, null, null, List.of(), null, false, true);
        }
    }

    // Thrown when an export/download is bigger than the configured maximum.
    static class TooLarge extends RuntimeException {
        TooLarge() { super("File larger than DRIVE_SYNC_MAX_FILE_BYTES"); }
    }

    public Content process(Request r, Predicate<String> haveCopy) {
        if (!r.reference()) return fetch(r, haveCopy);
        return fetch(r, fp -> haveCopy.test(DriveSyncStore.REF + fp)).asReference();
    }

    private Content fetch(Request r, Predicate<String> haveCopy) {
        if (r.size() != null && r.size() > props.maxFileBytes()) return Content.metadataOnly(r);
        var written = new ArrayList<String>();
        try {
            return switch (r.kind()) {
                case DOC -> doc(r, haveCopy, written);
                case SLIDES, SHEET -> pdfExport(r, haveCopy, written);
                case DRAWING -> drawing(r, haveCopy, written);
                case PDF -> binary(r, haveCopy, written, true);
                case IMAGE, OFFICE -> binary(r, haveCopy, written, false);
                case OTHER -> DriveMedia.isTextLike(r.mimeType(), r.name())
                    ? binary(r, haveCopy, written, false) : Content.metadataOnly(r);
                case FOLDER -> Content.metadataOnly(r);
            };
        } catch (TooLarge e) {
            cleanup(written);
            return Content.metadataOnly(r);
        } catch (DriveApiException e) {
            cleanup(written);
            if (e.isDownloadBlocked()) return Content.blocked(r);
            throw e;
        } catch (RuntimeException e) {
            cleanup(written);
            throw e;
        }
    }

    // ---- Docs ----------------------------------------------------------------

    private Content doc(Request r, Predicate<String> haveCopy, List<String> written) {
        ParsedDoc parsed = null;
        try {
            var zip = spool(drive.export(r.driveId(), "application/zip"));
            try {
                parsed = parseDoc(zip, r.reference());
            } finally {
                deleteQuietly(zip);
            }
        } catch (DriveApiException e) {
            if (!e.isExportTooLarge()) throw e;
            log.debug("Drive sync: {} too large for HTML export, PDF only", r.driveId());
        }
        if (parsed == null) return pdfExport(r, haveCopy, written);

        var fp = parsed.fingerprint();
        if (haveCopy.test(fp)) return Content.existing(r, fp);
        if (r.reference()) {
            // Neither images nor the PDF export are stored (the PDF streams on request).
            var html = parsed.html().replace("/api/v1/wiki/files/" + NEUTRAL_FILE + "/assets/",
                "/api/v1/wiki/files/" + r.fileId() + "/assets/");
            return new Content(r.version(), fp, html.length() <= MAX_HTML_CHARS ? html : null, null, null, null,
                null, List.of(), cap(parsed.text()), false, false);
        }
        var prefix = DriveBlobs.prefix(r.driveId(), fp);
        for (var asset : parsed.usedAssets()) {
            var bytes = parsed.assetBytes().get(asset);
            var key = prefix + "assets/" + asset;
            storage.put(key, imageType(asset), new ByteArrayInputStream(bytes), bytes.length);
            written.add(key);
        }
        String pdfKey = null;
        try {
            var pdf = exportToStorage(r.driveId(), "application/pdf", prefix + "export.pdf", written);
            deleteQuietly(pdf.file());
            pdfKey = pdf.key();
        } catch (DriveApiException e) {
            if (!e.isExportTooLarge()) throw e;
        }
        var html = parsed.html().replace("/api/v1/wiki/files/" + NEUTRAL_FILE + "/assets/",
            "/api/v1/wiki/files/" + r.fileId() + "/assets/");
        return new Content(r.version(), fp, html.length() <= MAX_HTML_CHARS ? html : null, pdfKey, null, null,
            parsed.usedAssets().isEmpty() ? null : prefix + "assets/", parsed.usedAssets(), cap(parsed.text()),
            false, false);
    }

    private record ParsedDoc(String html, String text, List<String> usedAssets, Map<String, byte[]> assetBytes,
                             String fingerprint) {}

    // withoutImages: the images are dropped from the HTML (reference mode).
    private ParsedDoc parseDoc(Path zipFile, boolean withoutImages) {
        String rawHtml = null;
        Map<String, byte[]> images = new LinkedHashMap<>();
        try (var zip = new ZipInputStream(Files.newInputStream(zipFile))) {
            for (var e = zip.getNextEntry(); e != null; e = zip.getNextEntry()) {
                if (e.isDirectory()) continue;
                var name = e.getName();
                var bytes = readCapped(zip);
                if (name.toLowerCase(Locale.ROOT).endsWith(".html") && rawHtml == null) {
                    rawHtml = new String(bytes, StandardCharsets.UTF_8);
                } else if (!withoutImages && images.size() < MAX_ASSETS && isImageName(name)) {
                    images.put(name, bytes);
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }

        // src as written in the HTML ("images/image1.png") -> stored asset name.
        Map<String, String> srcToAsset = new LinkedHashMap<>();
        Map<String, byte[]> assetBytes = new LinkedHashMap<>();
        for (var img : images.entrySet()) {
            var asset = uniqueAssetName(img.getKey(), assetBytes.keySet());
            srcToAsset.put(img.getKey(), asset);
            assetBytes.put(asset, img.getValue());
        }
        // Lists, bold/italic, alignment live in the export's CSS classes:
        // turned into markup before the sanitizer drops classes.
        var result = DocHtmlSanitizer.sanitize(GoogleDocsHtml.normalize(rawHtml), srcToAsset,
            "/api/v1/wiki/files/" + NEUTRAL_FILE + "/assets/");
        var digest = sha256();
        digest.update(("doc\n" + result.html()).getBytes(StandardCharsets.UTF_8));
        for (var asset : result.usedAssets()) {
            digest.update(("\n" + asset + "\n").getBytes(StandardCharsets.UTF_8));
            digest.update(assetBytes.get(asset));
        }
        return new ParsedDoc(result.html(), result.text(), result.usedAssets(), assetBytes, fingerprint(digest));
    }

    static String uniqueAssetName(String zipName, java.util.Set<String> taken) {
        var base = zipName.substring(zipName.lastIndexOf('/') + 1).replaceAll("[^A-Za-z0-9._-]", "_");
        if (base.isBlank() || base.startsWith(".")) base = "image" + base;
        var name = base;
        for (int i = 2; taken.contains(name); i++) name = i + "-" + base;
        return name;
    }

    private static boolean isImageName(String name) {
        return name.toLowerCase(Locale.ROOT).matches(".*\\.(png|jpe?g|gif|webp|bmp|svg)$");
    }

    static String imageType(String name) {
        var n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".gif")) return "image/gif";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".bmp")) return "image/bmp";
        // SVG can carry script: served as an opaque download type, never inline.
        return "application/octet-stream";
    }

    // ---- Slides, Sheets (and Docs too large for HTML) -----------------------

    private Content pdfExport(Request r, Predicate<String> haveCopy, List<String> written) {
        var file = spool(drive.export(r.driveId(), "application/pdf"));
        try {
            var info = pdfInfo(file);
            var fp = info == null ? fileFingerprint(file)
                : fingerprint(sha256(("pdf\n" + info.pages() + "\n" + info.text()).getBytes(StandardCharsets.UTF_8)));
            if (haveCopy.test(fp)) return Content.existing(r, fp);
            String key = null;
            if (!r.reference()) {
                key = DriveBlobs.prefix(r.driveId(), fp) + "export.pdf";
                storeFile(key, "application/pdf", file, written);
            }
            return new Content(r.version(), fp, null, key, null, null, null, List.of(),
                info == null ? null : cap(info.text()), false, false);
        } finally {
            deleteQuietly(file);
        }
    }

    // ---- Drawings -------------------------------------------------------------

    private Content drawing(Request r, Predicate<String> haveCopy, List<String> written) {
        if (r.reference()) {
            // No text to extract: not exported; the PNG streams on request.
            var fp = "meta:" + (r.version() == null ? 0 : r.version());
            if (haveCopy.test(fp)) return Content.existing(r, fp);
            return new Content(r.version(), fp, null, null, null, "image/png", null, List.of(), null, false, false);
        }
        var file = spool(drive.export(r.driveId(), "image/png"));
        try {
            var fp = fileFingerprint(file);
            if (haveCopy.test(fp)) return Content.existing(r, fp);
            var key = DriveBlobs.prefix(r.driveId(), fp) + "drawing.png";
            storeFile(key, "image/png", file, written);
            return new Content(r.version(), fp, null, null, key, "image/png", null, List.of(), null, false, false);
        } finally {
            deleteQuietly(file);
        }
    }

    // ---- Binary files -----------------------------------------------------------

    private Content binary(Request r, Predicate<String> haveCopy, List<String> written, boolean isPdf) {
        if (r.knownFingerprint() != null && haveCopy.test(r.knownFingerprint())) {
            return Content.existing(r, r.knownFingerprint());
        }
        var type = isPdf ? "application/pdf" : r.mimeType() == null ? "application/octet-stream" : r.mimeType();
        if (r.reference() && !isPdf && !DriveMedia.isTextLike(type, r.name())) {
            // Nothing to extract (images, Office): not downloaded at all.
            var fp = r.knownFingerprint() != null ? r.knownFingerprint()
                : "meta:" + (r.version() == null ? 0 : r.version()) + ":" + r.size();
            if (haveCopy.test(fp)) return Content.existing(r, fp);
            return new Content(r.version(), fp, null, null, null, type, null, List.of(), null, false, false);
        }
        var file = spool(drive.download(r.driveId()));
        try {
            var fp = r.knownFingerprint() != null ? r.knownFingerprint() : fileFingerprint(file);
            if (r.knownFingerprint() == null && haveCopy.test(fp)) return Content.existing(r, fp);
            var prefix = DriveBlobs.prefix(r.driveId(), fp);
            if (isPdf) {
                String key = null;
                if (!r.reference()) {
                    key = prefix + "original.pdf";
                    storeFile(key, "application/pdf", file, written);
                }
                var info = pdfInfo(file);
                return new Content(r.version(), fp, null, key, key, "application/pdf", null, List.of(),
                    info == null ? null : cap(info.text()), false, false);
            }
            String key = null;
            if (!r.reference()) {
                key = prefix + "original" + extension(r.name());
                storeFile(key, type, file, written);
            }
            String text = DriveMedia.isTextLike(type, r.name()) ? cap(readText(file)) : null;
            return new Content(r.version(), fp, null, null, key, type, null, List.of(), text, false, false);
        } finally {
            deleteQuietly(file);
        }
    }

    // ---- fetch + store ----------------------------------------------------------

    private record StoredFile(String key, Path file) {}

    private StoredFile exportToStorage(String driveId, String mime, String key, List<String> written) {
        var file = spool(drive.export(driveId, mime));
        try {
            storeFile(key, mime, file, written);
        } catch (RuntimeException e) {
            deleteQuietly(file);
            throw e;
        }
        return new StoredFile(key, file);
    }

    private void storeFile(String key, String contentType, Path file, List<String> written) {
        storage.putFile(key, contentType, file);
        written.add(key);
    }

    // Copies a Drive stream to a temp file, failing with TooLarge past the max.
    private Path spool(InputStream in) {
        Path tmp = null;
        try (in) {
            tmp = Files.createTempFile("drive-sync-", ".bin");
            long max = props.maxFileBytes();
            try (var out = Files.newOutputStream(tmp)) {
                var buf = new byte[64 * 1024];
                long total = 0;
                for (int n; (n = in.read(buf)) != -1; ) {
                    total += n;
                    if (total > max) throw new TooLarge();
                    out.write(buf, 0, n);
                }
            }
            return tmp;
        } catch (IOException e) {
            deleteQuietly(tmp);
            throw new DriveApiException(0, "io", "Reading Drive content failed: " + e.getMessage(), e);
        } catch (RuntimeException e) {
            deleteQuietly(tmp);
            throw e;
        }
    }

    private byte[] readCapped(ZipInputStream zip) throws IOException {
        var out = new java.io.ByteArrayOutputStream();
        var buf = new byte[64 * 1024];
        long max = props.maxFileBytes();
        for (int n; (n = zip.read(buf)) != -1; ) {
            if (out.size() + (long) n > max) throw new TooLarge();
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private record PdfInfo(String text, int pages) {}

    private static PdfInfo pdfInfo(Path pdf) {
        try (var doc = Loader.loadPDF(pdf.toFile())) {
            return new PdfInfo(new PDFTextStripper().getText(doc), doc.getNumberOfPages());
        } catch (IOException | RuntimeException e) {
            log.debug("Drive sync: PDF text extraction failed: {}", e.getMessage());
            return null;
        }
    }

    private static String readText(Path file) {
        try {
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    static String cap(String text) {
        if (text == null) return null;
        var t = text.replace("\u0000", "").strip();
        if (t.isEmpty()) return null;
        return t.length() <= MAX_TEXT_CHARS ? t : t.substring(0, MAX_TEXT_CHARS);
    }

    // ---- hashing ------------------------------------------------------------------

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static MessageDigest sha256(byte[] bytes) {
        var d = sha256();
        d.update(bytes);
        return d;
    }

    // "sha:" + 32 hex chars (fits content_fingerprint VARCHAR(64)).
    private static String fingerprint(MessageDigest digest) {
        return "sha:" + HexFormat.of().formatHex(digest.digest(), 0, 16);
    }

    private static String fileFingerprint(Path file) {
        var d = sha256();
        try (var in = Files.newInputStream(file)) {
            var buf = new byte[64 * 1024];
            for (int n; (n = in.read(buf)) != -1; ) d.update(buf, 0, n);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return fingerprint(d);
    }

    private static String extension(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        var ext = name.substring(dot).toLowerCase(Locale.ROOT);
        return ext.matches("\\.[a-z0-9]{1,8}") ? ext : "";
    }

    private void cleanup(List<String> written) {
        for (var key : written) {
            try {
                storage.delete(key);
            } catch (RuntimeException e) {
                log.warn("Drive sync: could not delete partial object {}: {}", key, e.getMessage());
            }
        }
    }

    private static void deleteQuietly(Path p) {
        if (p == null) return;
        try {
            Files.deleteIfExists(p);
        } catch (IOException ignored) {
            // temp file; the OS cleans it eventually
        }
    }
}
