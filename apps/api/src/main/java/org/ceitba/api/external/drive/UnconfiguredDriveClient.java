package org.ceitba.api.external.drive;

import java.io.InputStream;
import java.util.List;

// No service-account key: the feature is off (services check available()
// and answer DRIVE_SYNC_UNCONFIGURED before calling anything else).
public class UnconfiguredDriveClient implements DriveClient {

    @Override public boolean available() { return false; }
    @Override public String botEmail() { return null; }
    @Override public DriveItem getFile(String fileId) { throw unavailable(); }
    @Override public List<DriveItem> listChildren(String folderId) { throw unavailable(); }
    @Override public List<DriveItem> listSharedFolders() { throw unavailable(); }
    @Override public InputStream export(String fileId, String mimeType) { throw unavailable(); }
    @Override public InputStream download(String fileId) { throw unavailable(); }

    private static IllegalStateException unavailable() {
        return new IllegalStateException("Drive sync is not configured (DRIVE_SYNC_SERVICE_ACCOUNT_JSON)");
    }
}
