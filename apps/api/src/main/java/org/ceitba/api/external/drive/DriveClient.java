package org.ceitba.api.external.drive;

import java.io.InputStream;
import java.util.List;

// Read-only access to Google Drive as the bot service account (drive.readonly).
// Every call throws DriveApiException on failure. Implementations:
// GoogleDriveClient (real), FakeDriveClient (drive-sync.use-fake, tests and
// offline dev), UnconfiguredDriveClient (no key: available() is false).
public interface DriveClient {

    // Fields requested for every item.
    String FIELDS = "id,name,mimeType,parents,owners(emailAddress),modifiedTime,md5Checksum,version,size,"
        + "shortcutDetails(targetId,targetMimeType)";

    boolean available();

    // The service account's email, which students share their folder with.
    String botEmail();

    DriveItem getFile(String fileId);

    // Direct, non-trashed children of a folder (all pages).
    List<DriveItem> listChildren(String folderId);

    // Folders shared directly with the bot (sharedWithMe).
    List<DriveItem> listSharedFolders();

    // files.export of a native Google file. Caller closes the stream.
    InputStream export(String fileId, String mimeType);

    // files.get?alt=media of a binary file. Caller closes the stream.
    InputStream download(String fileId);
}
