package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

// S3-compatible object storage (self-hosted MinIO in production), bound from
// storage.* in application.yml. The feature is on only when every connection
// field is set; otherwise upload signing answers 501 (FeatureNotConfigured).
//
//   STORAGE_ENDPOINT=https://ceitba.org.ar        (Caddy proxies /ceitba-media/* to MinIO)
//   STORAGE_BUCKET=ceitba-media
//   STORAGE_ACCESS_KEY_ID=...  STORAGE_SECRET_ACCESS_KEY=...   (MinIO service user)
//   STORAGE_PUBLIC_URL=https://ceitba.org.ar/ceitba-media
//
// Presigned URLs are path style (endpoint/bucket/key) and are signed for the
// endpoint's host, so the endpoint must be the URL clients actually reach.
// region defaults to us-east-1 (MinIO's default). presign-ttl bounds how long
// a signed PUT URL stays usable. The older R2_* env names are fallbacks.
@ConfigurationProperties(prefix = "storage")
public record StorageProperties(
    String endpoint,
    String region,
    String bucket,
    String accessKeyId,
    String secretAccessKey,
    String publicBaseUrl,
    Duration presignTtl
) {
    public StorageProperties {
        region     = region == null || region.isBlank() ? "us-east-1" : region;
        presignTtl = presignTtl == null || presignTtl.isZero() || presignTtl.isNegative()
            ? Duration.ofMinutes(10) : presignTtl;
        if (publicBaseUrl != null) {
            publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
        }
    }

    public boolean configured() {
        return notBlank(endpoint) && notBlank(bucket) && notBlank(accessKeyId)
            && notBlank(secretAccessKey) && notBlank(publicBaseUrl);
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
