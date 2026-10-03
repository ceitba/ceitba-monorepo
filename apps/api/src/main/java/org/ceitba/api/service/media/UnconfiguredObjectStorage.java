package org.ceitba.api.service.media;

import org.ceitba.api.common.exception.FeatureNotConfiguredException;

import java.io.InputStream;
import java.time.Duration;

// Used when storage.* is incomplete (local dev, CI, tests): every sign
// request answers 501 and there are no public URLs.
public class UnconfiguredObjectStorage implements ObjectStorage {

    @Override
    public PresignedUpload presignPut(String key, String contentType, long contentLength) {
        throw notConfigured();
    }

    @Override
    public String publicUrl(String key) {
        return null;
    }

    @Override
    public void put(String key, String contentType, InputStream body, long length) {
        throw notConfigured();
    }

    @Override
    public byte[] get(String key) {
        throw notConfigured();
    }

    @Override
    public void delete(String key) {
        throw notConfigured();
    }

    @Override
    public String presignGet(String key, Duration ttl, String filename, boolean inline, String contentType) {
        throw notConfigured();
    }

    private static FeatureNotConfiguredException notConfigured() {
        return new FeatureNotConfiguredException(
            "Object storage not configured. Set STORAGE_ENDPOINT, STORAGE_BUCKET, "
                + "STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY and STORAGE_PUBLIC_URL.");
    }
}
