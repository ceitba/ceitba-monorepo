package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

// S3-compatible object storage (Cloudflare R2 in production), bound from
// storage.* in application.yml. The feature is on only when every connection
// field is set; otherwise upload signing answers 501 (FeatureNotConfigured).
//
//   R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
//   R2_BUCKET=ceitba-media
//   R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...
//   R2_PUBLIC_URL=https://media.ceitba.org.ar   (bucket's public/custom domain)
//
// region is "auto" for R2; AWS S3 needs a real region. presign-ttl bounds how
// long a signed PUT URL stays usable.
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
        region     = region == null || region.isBlank() ? "auto" : region;
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
