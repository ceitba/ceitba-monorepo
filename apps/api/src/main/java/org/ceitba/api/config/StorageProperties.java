package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.ConstructorBinding;

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
//
// internal-endpoint (STORAGE_INTERNAL_ENDPOINT, e.g. http://minio:9000) is
// where the API itself reads/writes objects (Drive sync copies). It skips
// Caddy, whose /ceitba-media request-body limit is sized for phone uploads.
// Empty = use endpoint. Presigned URLs are always signed for endpoint.
@ConfigurationProperties(prefix = "storage")
public record StorageProperties(
    String endpoint,
    String region,
    String bucket,
    String accessKeyId,
    String secretAccessKey,
    String publicBaseUrl,
    Duration presignTtl,
    String internalEndpoint
) {
    @ConstructorBinding
    public StorageProperties {
        region     = region == null || region.isBlank() ? "us-east-1" : region;
        presignTtl = presignTtl == null || presignTtl.isZero() || presignTtl.isNegative()
            ? Duration.ofMinutes(10) : presignTtl;
        if (publicBaseUrl != null) {
            publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
        }
    }

    public StorageProperties(String endpoint, String region, String bucket, String accessKeyId,
                             String secretAccessKey, String publicBaseUrl, Duration presignTtl) {
        this(endpoint, region, bucket, accessKeyId, secretAccessKey, publicBaseUrl, presignTtl, null);
    }

    // Where the API's own S3 calls go: internal-endpoint, else endpoint.
    public String serverEndpoint() {
        return notBlank(internalEndpoint) ? internalEndpoint : endpoint;
    }

    public boolean configured() {
        return notBlank(endpoint) && notBlank(bucket) && notBlank(accessKeyId)
            && notBlank(secretAccessKey) && notBlank(publicBaseUrl);
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
