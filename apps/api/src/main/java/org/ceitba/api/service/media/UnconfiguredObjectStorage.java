package org.ceitba.api.service.media;

import org.ceitba.api.common.exception.FeatureNotConfiguredException;

// Used when storage.* is incomplete (local dev, CI, tests): every sign
// request answers 501 and there are no public URLs.
public class UnconfiguredObjectStorage implements ObjectStorage {

    @Override
    public PresignedUpload presignPut(String key, String contentType, long contentLength) {
        throw new FeatureNotConfiguredException(
            "Object storage not configured. Set STORAGE_ENDPOINT, STORAGE_BUCKET, "
                + "STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY and STORAGE_PUBLIC_URL.");
    }

    @Override
    public String publicUrl(String key) {
        return null;
    }
}
