package org.ceitba.api.external.drive;

import com.google.api.client.googleapis.json.GoogleJsonResponseException;
import com.google.api.client.http.HttpRequestInitializer;
import com.google.api.client.http.HttpResponseException;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.drive.Drive;
import com.google.api.services.drive.DriveScopes;
import com.google.api.services.drive.model.File;
import com.google.api.services.drive.model.User;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.ServiceAccountCredentials;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

// Drive v3 as the bot service account, scope drive.readonly. The key is the
// service-account JSON, base64-encoded (raw JSON is accepted too).
//
// Rate limits (429, 403 rateLimitExceeded/userRateLimitExceeded) and 5xx/I/O
// errors are retried with exponential back-off and jitter (1s, 2s, 4s); after
// that the DriveApiException reaches the sync, which stops the run.
public class GoogleDriveClient implements DriveClient {

    private static final Logger log = LoggerFactory.getLogger(GoogleDriveClient.class);

    private static final int MAX_ATTEMPTS = 4;
    private static final int CONNECT_TIMEOUT_MS = 20_000;
    private static final int READ_TIMEOUT_MS = 120_000;

    private final Drive drive;
    private final String botEmail;

    public GoogleDriveClient(String serviceAccountKey) {
        try {
            var credentials = ServiceAccountCredentials
                .fromStream(new ByteArrayInputStream(decodeKey(serviceAccountKey)))
                .createScoped(List.of(DriveScopes.DRIVE_READONLY));
            this.botEmail = ((ServiceAccountCredentials) credentials).getClientEmail();
            var adapter = new HttpCredentialsAdapter(credentials);
            HttpRequestInitializer init = request -> {
                adapter.initialize(request);
                request.setConnectTimeout(CONNECT_TIMEOUT_MS);
                request.setReadTimeout(READ_TIMEOUT_MS);
            };
            this.drive = new Drive.Builder(new NetHttpTransport(), GsonFactory.getDefaultInstance(), init)
                .setApplicationName("ceitba-api")
                .build();
        } catch (IOException e) {
            throw new IllegalArgumentException("Invalid DRIVE_SYNC_SERVICE_ACCOUNT_JSON: " + e.getMessage(), e);
        }
    }

    static byte[] decodeKey(String key) {
        var trimmed = key.trim();
        if (trimmed.startsWith("{")) return trimmed.getBytes(StandardCharsets.UTF_8);
        return Base64.getMimeDecoder().decode(trimmed);
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public String botEmail() {
        return botEmail;
    }

    @Override
    public DriveItem getFile(String fileId) {
        return withRetry("get " + fileId, () -> toItem(drive.files().get(fileId)
            .setFields(FIELDS)
            .setSupportsAllDrives(true)
            .execute()));
    }

    @Override
    public List<DriveItem> listChildren(String folderId) {
        return list("'" + folderId.replace("\\", "\\\\").replace("'", "\\'") + "' in parents and trashed=false");
    }

    @Override
    public List<DriveItem> listSharedFolders() {
        return list("sharedWithMe and mimeType='" + DriveItem.FOLDER_MIME + "' and trashed=false");
    }

    private List<DriveItem> list(String q) {
        var out = new ArrayList<DriveItem>();
        String pageToken = null;
        do {
            final String token = pageToken;
            var page = withRetry("list", () -> drive.files().list()
                .setQ(q)
                .setFields("nextPageToken,files(" + FIELDS + ")")
                .setPageSize(1000)
                .setSupportsAllDrives(true)
                .setIncludeItemsFromAllDrives(true)
                .setPageToken(token)
                .execute());
            if (page.getFiles() != null) page.getFiles().forEach(f -> out.add(toItem(f)));
            pageToken = page.getNextPageToken();
        } while (pageToken != null);
        return out;
    }

    @Override
    public InputStream export(String fileId, String mimeType) {
        return withRetry("export " + fileId, () -> drive.files().export(fileId, mimeType).executeMediaAsInputStream());
    }

    @Override
    public InputStream download(String fileId) {
        return withRetry("download " + fileId, () -> drive.files().get(fileId)
            .setSupportsAllDrives(true)
            .executeMediaAsInputStream());
    }

    private interface Call<T> {
        T run() throws IOException;
    }

    private <T> T withRetry(String what, Call<T> call) {
        long delayMs = 1000;
        for (int attempt = 1; ; attempt++) {
            try {
                return call.run();
            } catch (IOException e) {
                var ex = translate(e);
                if (!ex.isTransient() || attempt >= MAX_ATTEMPTS) throw ex;
                log.debug("Drive {} failed ({} {}), retry {} in {} ms", what, ex.status(), ex.reason(), attempt, delayMs);
                sleep(delayMs + ThreadLocalRandom.current().nextLong(250));
                delayMs *= 2;
            }
        }
    }

    static DriveApiException translate(IOException e) {
        if (e instanceof GoogleJsonResponseException g) {
            String reason = null;
            if (g.getDetails() != null && g.getDetails().getErrors() != null && !g.getDetails().getErrors().isEmpty()) {
                reason = g.getDetails().getErrors().get(0).getReason();
            }
            String message = g.getDetails() != null ? g.getDetails().getMessage() : g.getStatusMessage();
            return new DriveApiException(g.getStatusCode(), reason, message, e);
        }
        if (e instanceof HttpResponseException h) {
            return new DriveApiException(h.getStatusCode(), null, h.getStatusMessage(), e);
        }
        return new DriveApiException(0, "io", e.getClass().getSimpleName() + ": " + e.getMessage(), e);
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new DriveApiException(0, "interrupted", "Interrupted during back-off");
        }
    }

    private static DriveItem toItem(File f) {
        List<String> owners = f.getOwners() == null ? List.of()
            : f.getOwners().stream().map(User::getEmailAddress).filter(e -> e != null).toList();
        var shortcut = f.getShortcutDetails();
        return new DriveItem(
            f.getId(),
            f.getName(),
            f.getMimeType(),
            f.getParents(),
            owners,
            f.getModifiedTime() == null ? null : Instant.ofEpochMilli(f.getModifiedTime().getValue()),
            f.getMd5Checksum(),
            f.getVersion(),
            f.getSize(),
            shortcut == null ? null : shortcut.getTargetId(),
            shortcut == null ? null : shortcut.getTargetMimeType(),
            f.getCreatedTime() == null ? null : Instant.ofEpochMilli(f.getCreatedTime().getValue()));
    }
}
