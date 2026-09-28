package org.ceitba.api.service.media;

import org.ceitba.api.common.exception.FeatureNotConfiguredException;

// Used when storage.* is incomplete (local dev, CI, tests): every sign
// request answers 501 and there are no public URLs.
public class UnconfiguredObjectStorage implements ObjectStorage {

    @Override
    public PresignedUpload presignPut(String key, String contentType, long contentLength) {
        throw new FeatureNotConfiguredException(
            "Cloud storage not configured. Set R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, "
                + "R2_SECRET_ACCESS_KEY and R2_PUBLIC_URL.");
    }

    @Override
    public String publicUrl(String key) {
        return null;
    }
}
