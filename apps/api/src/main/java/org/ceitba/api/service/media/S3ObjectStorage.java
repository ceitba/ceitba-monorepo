package org.ceitba.api.service.media;

import org.ceitba.api.config.StorageProperties;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

import java.time.Clock;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

// SigV4 presigned PUTs against an S3-compatible endpoint (Cloudflare R2).
// Presigning is pure local computation: no request reaches the bucket here.
public class S3ObjectStorage implements ObjectStorage {

    private final S3Presigner presigner;
    private final StorageProperties props;
    private final Clock clock;

    public S3ObjectStorage(S3Presigner presigner, StorageProperties props, Clock clock) {
        this.presigner = presigner;
        this.props = props;
        this.clock = clock;
    }

    @Override
    public PresignedUpload presignPut(String key, String contentType, long contentLength) {
        var put = PutObjectRequest.builder()
            .bucket(props.bucket())
            .key(key)
            .contentType(contentType)
            .contentLength(contentLength)
            .build();
        var presigned = presigner.presignPutObject(PutObjectPresignRequest.builder()
            .signatureDuration(props.presignTtl())
            .putObjectRequest(put)
            .build());

        // The SDK reports every signed header in lowercase, including Host
        // (which HTTP clients set themselves and must not be sent twice).
        Map<String, String> headers = new TreeMap<>();
        presigned.signedHeaders().forEach((name, values) -> {
            if (!"host".equalsIgnoreCase(name)) headers.put(canonical(name), String.join(",", values));
        });
        headers.putIfAbsent("Content-Type", contentType);

        var expiresAt = presigned.expiration() != null
            ? presigned.expiration()
            : clock.instant().plus(props.presignTtl());
        return new PresignedUpload(presigned.url().toString(), headers, expiresAt);
    }

    // "content-type" -> "Content-Type"
    static String canonical(String headerName) {
        var parts = headerName.toLowerCase(Locale.ROOT).split("-");
        var out = new StringBuilder();
        for (var part : parts) {
            if (out.length() > 0) out.append('-');
            if (!part.isEmpty()) out.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1));
        }
        return out.toString();
    }

    @Override
    public String publicUrl(String key) {
        return props.publicBaseUrl() + "/" + key;
    }
}
