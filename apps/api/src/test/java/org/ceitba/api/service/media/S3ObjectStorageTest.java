package org.ceitba.api.service.media;

import org.ceitba.api.config.StorageConfig;
import org.ceitba.api.config.StorageProperties;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

// Real SigV4 presigning with dummy credentials: presigning is local, so this
// checks the exact signing inputs without a bucket.
class S3ObjectStorageTest {

    private static final StorageProperties PROPS = new StorageProperties(
        "https://acct123.r2.cloudflarestorage.com", null, "ceitba-media",
        "AKIDTEST", "secret-test", "https://media.example.org/", Duration.ofMinutes(5));

    private final S3ObjectStorage storage = new S3ObjectStorage(
        StorageConfig.presigner(PROPS), PROPS,
        Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC));

    @Test
    void presignPut_signsPathStyleUrlWithTypeAndLength() {
        var up = storage.presignPut("proposals/abc/file.pdf", "application/pdf", 1234);

        var url = URI.create(up.uploadUrl());
        assertThat(url.getHost()).isEqualTo("acct123.r2.cloudflarestorage.com");
        assertThat(url.getPath()).isEqualTo("/ceitba-media/proposals/abc/file.pdf");
        assertThat(url.getQuery())
            .contains("X-Amz-Algorithm=AWS4-HMAC-SHA256")
            .contains("X-Amz-Expires=300")
            .contains("/auto/s3/aws4_request")
            .contains("X-Amz-SignedHeaders=content-length;content-type;host")
            .contains("X-Amz-Signature=");

        assertThat(up.headers())
            .containsEntry("Content-Type", "application/pdf")
            .containsEntry("Content-Length", "1234")
            .doesNotContainKey("Host")
            .doesNotContainKey("host");
        assertThat(up.expiresAt()).isNotNull();
    }

    @Test
    void publicUrl_joinsBaseWithoutDoubleSlash() {
        assertThat(storage.publicUrl("media/x.png")).isEqualTo("https://media.example.org/media/x.png");
    }

    @Test
    void propertiesDefaults() {
        var p = new StorageProperties("e", " ", "b", "k", "s", "u", null);
        assertThat(p.region()).isEqualTo("auto");
        assertThat(p.presignTtl()).isEqualTo(Duration.ofMinutes(10));
        assertThat(p.configured()).isTrue();
        assertThat(new StorageProperties(null, null, null, null, null, null, null).configured()).isFalse();
    }
}
