package org.ceitba.api.service.drive;

import org.ceitba.api.common.exception.ExternalApiException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.config.DriveSyncProperties;
import org.ceitba.api.external.drive.DriveApiException;
import org.ceitba.api.external.drive.DriveClient;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

// Streams a file kept by reference (REFERENCE mode) from Drive through the
// bot, for the download endpoint (after its access and capability checks;
// DriveReaderService.download). Nothing is stored. Bytes past
// DRIVE_SYNC_MAX_FILE_BYTES are never sent (the response is cut). Runs
// outside any transaction.
@Component
public class DriveStreamer {

    // exportMime null: files.get?alt=media, else files.export to that type.
    // contentType/inline: what the response is served as (DriveReaderService
    // applies DriveMedia's inline rule). length: known size, or null.
    public record Request(String driveId, String exportMime, String contentType, boolean inline, String filename,
                          Long length) {}

    private final DriveClient drive;
    private final DriveSyncProperties props;

    public DriveStreamer(DriveClient drive, DriveSyncProperties props) {
        this.drive = drive;
        this.props = props;
    }

    public long maxBytes() {
        return props.maxFileBytes();
    }

    // Opens the Drive stream before the response is committed, so failures
    // still map to proper errors (404 when the bot lost access or the owner
    // disabled downloads, 502 otherwise).
    public InputStream open(Request r) {
        if (r.length() != null && r.length() > props.maxFileBytes()) {
            throw new ResourceNotFoundException("DriveFile download", r.driveId());
        }
        try {
            return r.exportMime() == null ? drive.download(r.driveId()) : drive.export(r.driveId(), r.exportMime());
        } catch (DriveApiException e) {
            if (e.isNotFoundOrForbidden() || e.isDownloadBlocked() || e.isExportTooLarge()) {
                throw new ResourceNotFoundException("DriveFile download", r.driveId());
            }
            throw new ExternalApiException("Google Drive", r.exportMime() == null ? "files.get" : "files.export", e);
        }
    }

    // Copies at most maxBytes(); closes `in`.
    public void copy(InputStream in, OutputStream out) throws IOException {
        long max = props.maxFileBytes();
        try (in) {
            var buf = new byte[64 * 1024];
            long total = 0;
            for (int n; (n = in.read(buf)) != -1; ) {
                total += n;
                if (total > max) throw new IOException("Drive stream larger than DRIVE_SYNC_MAX_FILE_BYTES");
                out.write(buf, 0, n);
            }
        }
    }
}
