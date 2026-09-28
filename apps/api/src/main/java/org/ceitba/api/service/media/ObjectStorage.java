package org.ceitba.api.service.media;

// Port to the object store. The only operation the API needs is handing a
// client a short-lived URL to PUT one object directly into the bucket; the
// API never proxies file bytes. See StorageConfig for how the implementation
// is chosen.
public interface ObjectStorage {

    // Signs a PUT of exactly `contentLength` bytes of `contentType` to `key`.
    // Both are signed headers, so the upload must send the same values.
    // Throws FeatureNotConfiguredException when storage is not configured.
    PresignedUpload presignPut(String key, String contentType, long contentLength);

    // Public, unsigned URL of an object, or null when storage is not configured.
    String publicUrl(String key);
}
