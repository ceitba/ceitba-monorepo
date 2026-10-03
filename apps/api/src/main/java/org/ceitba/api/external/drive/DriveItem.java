package org.ceitba.api.external.drive;

import java.time.Instant;
import java.util.List;

// The Drive metadata the sync needs (files.list/get with DriveClient.FIELDS).
// version/md5Checksum/size are null where Drive omits them (folders, native
// Google files have no md5/size).
public record DriveItem(
    String id,
    String name,
    String mimeType,
    List<String> parents,
    List<String> ownerEmails,
    Instant modifiedTime,
    String md5Checksum,
    Long version,
    Long size,
    String shortcutTargetId,
    String shortcutTargetMimeType
) {
    public static final String FOLDER_MIME = "application/vnd.google-apps.folder";
    public static final String SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

    public DriveItem {
        parents = parents == null ? List.of() : List.copyOf(parents);
        ownerEmails = ownerEmails == null ? List.of() : List.copyOf(ownerEmails);
    }

    public boolean isFolder() { return FOLDER_MIME.equals(mimeType); }
    public boolean isShortcut() { return SHORTCUT_MIME.equals(mimeType); }

    // Content fingerprint of a binary file (md5Checksum), known without
    // downloading it; null for native Google files, whose fingerprint is a
    // hash of their export (DriveContentProcessor).
    public String binaryFingerprint() {
        return md5Checksum == null ? null : "md5:" + md5Checksum;
    }

    public String firstOwner() { return ownerEmails.isEmpty() ? null : ownerEmails.get(0); }

    public boolean ownedBy(String email) {
        return email != null && ownerEmails.stream().anyMatch(email::equalsIgnoreCase);
    }
}
