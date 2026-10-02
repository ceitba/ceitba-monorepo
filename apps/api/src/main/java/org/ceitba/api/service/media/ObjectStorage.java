package org.ceitba.api.service.media;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

// Port to the object store. Clients upload directly to the bucket with a
// short-lived signed PUT (presignPut) and the API never proxies those bytes.
// The API itself only writes objects it copies from elsewhere (Drive sync:
// put/delete) and hands readers short-lived signed GETs for objects that are
// not public (presignGet). See StorageConfig for how the implementation is
// chosen.
public interface ObjectStorage {

    // Signs a PUT of exactly `contentLength` bytes of `contentType` to `key`.
    // Both are signed headers, so the upload must send the same values.
    // Throws FeatureNotConfiguredException when storage is not configured.
    PresignedUpload presignPut(String key, String contentType, long contentLength);

    // Public, unsigned URL of an object, or null when storage is not configured.
    String publicUrl(String key);

    // Uploads `length` bytes from `body` to `key` (server side). The stream is
    // read but not closed. Throws FeatureNotConfiguredException when storage
    // is not configured.
    default void put(String key, String contentType, InputStream body, long length) {
        throw new UnsupportedOperationException("put is not supported by " + getClass().getSimpleName());
    }

    // Uploads a local file. Implementations that need to re-read the body
    // (payload signing, retries) override this to use the file directly.
    default void putFile(String key, String contentType, Path file) {
        try (var in = Files.newInputStream(file)) {
            put(key, contentType, in, Files.size(file));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    // Deletes `key`; deleting a missing object is not an error. Throws
    // FeatureNotConfiguredException when storage is not configured.
    default void delete(String key) {
        throw new UnsupportedOperationException("delete is not supported by " + getClass().getSimpleName());
    }

    // Signed GET URL of `key`, valid for `ttl`. When `downloadFilename` is not
    // null the response is served as an attachment with that file name.
    // Throws FeatureNotConfiguredException when storage is not configured.
    default String presignGet(String key, Duration ttl, String downloadFilename) {
        throw new UnsupportedOperationException("presignGet is not supported by " + getClass().getSimpleName());
    }

    default String presignGet(String key, Duration ttl) {
        return presignGet(key, ttl, null);
    }
}
