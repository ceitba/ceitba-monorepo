package org.ceitba.api.external.drive;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

// In-memory Drive (drive-sync.use-fake=true) for tests and offline dev.
// Tests build a tree with folder()/doc()/file()/shortcut() and mutate it with
// updateDoc()/updateFile()/rename()/move()/remove()/revoke(). Every change
// bumps the item's version and modifiedTime the way Drive does.
//
// Exports: a Doc exports as application/zip (index.html + images/*) and as a
// real PDF (made with PDFBox from the doc's text); Slides/Sheets as PDF;
// Drawings as PNG. Binary files download their bytes.
//
// seedDemo(email) creates folder "demo-<local part>" owned by `email` with a
// small tree (drive-sync.fake-demo-owners), so the local stack works with dev
// login and no Google account.
public class FakeDriveClient implements DriveClient {

    public static final String BOT_EMAIL = "apuntes-bot@ceitba-dev.iam.gserviceaccount.com";

    private static final String DOC = "application/vnd.google-apps.document";

    private final Map<String, Node> nodes = new ConcurrentHashMap<>();
    private final Set<String> sharedWithBot = ConcurrentHashMap.newKeySet();
    private final Set<String> exportTooLarge = ConcurrentHashMap.newKeySet();
    private final Set<String> downloadBlocked = ConcurrentHashMap.newKeySet();
    private final AtomicLong clock = new AtomicLong(Instant.parse("2026-01-01T00:00:00Z").toEpochMilli());
    private final Map<String, Integer> fetches = new ConcurrentHashMap<>();

    private static final class Node {
        String id;
        String name;
        String mimeType;
        String parent;
        String owner;
        long version = 1;
        Instant modified;
        Instant created;
        byte[] content;
        String html;
        Map<String, byte[]> images = new LinkedHashMap<>();
        String shortcutTarget;
        boolean revoked;
    }

    // ---- building the tree -------------------------------------------------

    public synchronized void reset() {
        nodes.clear();
        sharedWithBot.clear();
        exportTooLarge.clear();
        downloadBlocked.clear();
        fetches.clear();
    }

    // How many exports + downloads hit this item (tests assert "no refetch").
    public int fetchCount(String id) {
        return fetches.getOrDefault(id, 0);
    }

    // A folder; with parent == null it is a root shared with the bot.
    public FakeDriveClient folder(String id, String name, String parent, String owner) {
        var n = node(id, name, DriveItem.FOLDER_MIME, parent, owner);
        if (parent == null) sharedWithBot.add(id);
        return this;
    }

    public FakeDriveClient doc(String id, String name, String parent, String owner, String html) {
        return doc(id, name, parent, owner, html, Map.of());
    }

    // `images` maps file names referenced as images/<name> in the html to bytes.
    public FakeDriveClient doc(String id, String name, String parent, String owner, String html,
                               Map<String, byte[]> images) {
        var n = node(id, name, DOC, parent, owner);
        n.html = html;
        n.images.putAll(images);
        return this;
    }

    // Any other file: native Google (slides/sheets/drawing) or binary.
    public FakeDriveClient file(String id, String name, String mimeType, String parent, String owner, byte[] content) {
        var n = node(id, name, mimeType, parent, owner);
        n.content = content;
        return this;
    }

    public FakeDriveClient shortcut(String id, String name, String parent, String owner, String targetId) {
        var n = node(id, name, DriveItem.SHORTCUT_MIME, parent, owner);
        n.shortcutTarget = targetId;
        return this;
    }

    public synchronized void updateDoc(String id, String html) {
        var n = require(id);
        n.html = html;
        touch(n);
    }

    public synchronized void updateFile(String id, byte[] content) {
        var n = require(id);
        n.content = content;
        touch(n);
    }

    // Like Drive: a rename bumps version and modifiedTime (observed on Docs),
    // the content stays the same.
    public synchronized void rename(String id, String name) {
        var n = require(id);
        n.name = name;
        touch(n);
    }

    // A move changes only parents (observed: modifiedTime unchanged).
    public synchronized void move(String id, String newParent) {
        var n = require(id);
        n.parent = newParent;
        n.version++;
    }

    // Deleted or trashed: it disappears from listings and get() answers 404.
    public synchronized void remove(String id) {
        nodes.remove(id);
        sharedWithBot.remove(id);
    }

    // The owner unshared the folder: 404 for the folder and everything below.
    public synchronized void revoke(String id) {
        require(id).revoked = true;
        sharedWithBot.remove(id);
    }

    // Backdates an item (createdTime and modifiedTime), e.g. "made in 2019".
    public synchronized void setCreated(String id, Instant created) {
        var n = require(id);
        n.created = created;
        n.modified = created;
        n.version++;
    }

    public void setExportTooLarge(String id, boolean tooLarge) {
        if (tooLarge) exportTooLarge.add(id); else exportTooLarge.remove(id);
    }

    // The owner disabled download/print/copy for viewers (Drive answers 403
    // cannotExportFile / cannotDownloadFile). Unblocking bumps the version.
    public synchronized void setDownloadBlocked(String id, boolean blocked) {
        if (blocked) downloadBlocked.add(id); else downloadBlocked.remove(id);
        require(id).version++;
    }

    // Shared with the bot (shows in sharedWithMe) without being registered.
    public void share(String id) {
        sharedWithBot.add(id);
    }

    public void seedDemo(String ownerEmail) {
        var email = ownerEmail.trim().toLowerCase(Locale.ROOT);
        var local = email.contains("@") ? email.substring(0, email.indexOf('@')) : email;
        var root = "demo-" + local;
        folder(root, "Apuntes de " + local, null, email);
        folder(root + "-fis", "Física I", root, email);
        doc(root + "-fis-res", "Resumen cinemática", root + "-fis", email,
            "<html><body><h1>Cinemática</h1><p>MRU: x = x0 + v t.</p>"
                + "<p><img src=\"images/image1.png\"></p></body></html>",
            Map.of("image1.png", tinyPng()));
        file(root + "-fis-tp", "TP1 - Vectores.pdf", "application/pdf", root + "-fis", email,
            pdf("TP1 Vectores: suma, producto escalar y vectorial."));
        folder(root + "-am", "Analisis Matematico I", root, email);
        file(root + "-am-parc", "Parcial resuelto.pdf", "application/pdf", root + "-am", email,
            pdf("Parcial resuelto de Análisis Matemático I: límites y derivadas."));
        file(root + "-am-ajeno", "Guía de la cátedra.pdf", "application/pdf", root + "-am",
            "catedra@itba.edu.ar", pdf("Guía de ejercicios de la cátedra."));
        folder(root + "-varios", "Varios", root, email);
        file(root + "-varios-img", "pizarron.png", "image/png", root + "-varios", email, tinyPng());
    }

    private synchronized Node node(String id, String name, String mimeType, String parent, String owner) {
        var n = new Node();
        n.id = id;
        n.name = name;
        n.mimeType = mimeType;
        n.parent = parent;
        n.owner = owner;
        n.modified = Instant.ofEpochMilli(clock.addAndGet(60_000));
        n.created = n.modified;
        nodes.put(id, n);
        return n;
    }

    private void touch(Node n) {
        n.version++;
        n.modified = Instant.ofEpochMilli(clock.addAndGet(60_000));
    }

    private Node require(String id) {
        var n = nodes.get(id);
        if (n == null) throw new IllegalArgumentException("No fake Drive item " + id);
        return n;
    }

    // ---- DriveClient -------------------------------------------------------

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public String botEmail() {
        return BOT_EMAIL;
    }

    @Override
    public synchronized DriveItem getFile(String fileId) {
        var n = nodes.get(fileId);
        if (n == null || revoked(n)) throw DriveApiException.notFound(fileId);
        return toItem(n);
    }

    @Override
    public synchronized List<DriveItem> listChildren(String folderId) {
        var parent = nodes.get(folderId);
        if (parent == null || revoked(parent)) throw DriveApiException.notFound(folderId);
        var out = new ArrayList<DriveItem>();
        for (var n : nodes.values()) {
            if (folderId.equals(n.parent)) out.add(toItem(n));
        }
        out.sort((a, b) -> a.id().compareTo(b.id()));
        return out;
    }

    @Override
    public synchronized List<DriveItem> listSharedFolders() {
        var out = new ArrayList<DriveItem>();
        for (var id : sharedWithBot) {
            var n = nodes.get(id);
            if (n != null && !revoked(n) && DriveItem.FOLDER_MIME.equals(n.mimeType)) out.add(toItem(n));
        }
        return out;
    }

    @Override
    public synchronized InputStream export(String fileId, String mimeType) {
        var n = nodes.get(fileId);
        if (n == null || revoked(n)) throw DriveApiException.notFound(fileId);
        if (!n.mimeType.startsWith("application/vnd.google-apps.")) {
            throw new DriveApiException(403, "fileNotExportable", "Only Google files can be exported");
        }
        fetches.merge(fileId, 1, Integer::sum);
        if (downloadBlocked.contains(fileId)) {
            throw new DriveApiException(403, "cannotExportFile", "This file cannot be exported by the user.");
        }
        if (exportTooLarge.contains(fileId)) {
            throw new DriveApiException(403, "exportSizeLimitExceeded", "This file is too large to be exported.");
        }
        return new ByteArrayInputStream(switch (mimeType) {
            case "application/zip" -> {
                if (!DOC.equals(n.mimeType)) throw new DriveApiException(400, "badRequest", "Unsupported export");
                yield zip(n);
            }
            case "application/pdf" -> pdf(DOC.equals(n.mimeType) ? textOf(n.html) : n.name + " "
                + (n.content == null ? "" : new String(n.content, StandardCharsets.UTF_8)));
            case "image/png" -> n.content != null ? n.content : tinyPng();
            default -> throw new DriveApiException(400, "badRequest", "Unsupported export " + mimeType);
        });
    }

    @Override
    public synchronized InputStream download(String fileId) {
        var n = nodes.get(fileId);
        if (n == null || revoked(n)) throw DriveApiException.notFound(fileId);
        if (n.mimeType.startsWith("application/vnd.google-apps.")) {
            throw new DriveApiException(403, "fileNotDownloadable", "Use export for Google files");
        }
        if (downloadBlocked.contains(fileId)) {
            throw new DriveApiException(403, "cannotDownloadFile", "This file cannot be downloaded by the user.");
        }
        fetches.merge(fileId, 1, Integer::sum);
        return new ByteArrayInputStream(n.content == null ? new byte[0] : n.content);
    }

    // Revoked itself or below a revoked folder.
    private boolean revoked(Node n) {
        var cur = n;
        for (int depth = 0; cur != null && depth < 100; depth++) {
            if (cur.revoked) return true;
            cur = cur.parent == null ? null : nodes.get(cur.parent);
        }
        return false;
    }

    private DriveItem toItem(Node n) {
        boolean binary = !n.mimeType.startsWith("application/vnd.google-apps.");
        String targetMime = null;
        if (n.shortcutTarget != null) {
            var t = nodes.get(n.shortcutTarget);
            targetMime = t == null ? null : t.mimeType;
        }
        return new DriveItem(n.id, n.name, n.mimeType,
            n.parent == null ? List.of() : List.of(n.parent),
            n.owner == null ? List.of() : List.of(n.owner),
            n.modified,
            binary && n.content != null ? md5(n.content) : null,
            n.version,
            binary && n.content != null ? (long) n.content.length : null,
            n.shortcutTarget, targetMime, n.created);
    }

    // ---- content helpers ---------------------------------------------------

    private static byte[] zip(Node n) {
        try (var bytes = new ByteArrayOutputStream(); var zip = new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry(safe(n.name) + ".html"));
            zip.write((n.html == null ? "" : n.html).getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            for (var img : n.images.entrySet()) {
                zip.putNextEntry(new ZipEntry("images/" + img.getKey()));
                zip.write(img.getValue());
                zip.closeEntry();
            }
            zip.finish();
            return bytes.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String safe(String name) {
        return name.replaceAll("[^A-Za-z0-9]+", "");
    }

    private static String textOf(String html) {
        return html == null ? "" : org.jsoup.Jsoup.parse(html).text();
    }

    // A one-page PDF with `text` (Latin-1 only; other characters become '?').
    public static byte[] pdf(String text) {
        try (var doc = new PDDocument(); var out = new ByteArrayOutputStream()) {
            var page = new PDPage();
            doc.addPage(page);
            try (var cs = new PDPageContentStream(doc, page)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 11);
                cs.newLineAtOffset(50, 700);
                cs.showText(latin1(text));
                cs.endText();
            }
            doc.save(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String latin1(String s) {
        var sb = new StringBuilder();
        for (char c : s.toCharArray()) sb.append(c >= 32 && c <= 255 && c != 127 ? c : '?');
        return sb.toString();
    }

    // 1x1 transparent PNG.
    public static byte[] tinyPng() {
        return java.util.Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
    }

    private static String md5(byte[] content) {
        try {
            var d = java.security.MessageDigest.getInstance("MD5").digest(content);
            return java.util.HexFormat.of().formatHex(d);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
