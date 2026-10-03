package org.ceitba.api.service.media;

import org.ceitba.api.config.StorageProperties;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

// SigV4 presigned PUTs/GETs against an S3-compatible endpoint (MinIO in
// prod). Presigning is pure local computation: no request reaches the bucket
// there. put/delete (Drive sync) go through `client`, which talks to
// storage.internal-endpoint when set.
public class S3ObjectStorage implements ObjectStorage {

    private final S3Presigner presigner;
    private final S3Client client;
    private final StorageProperties props;
    private final Clock clock;

    public S3ObjectStorage(S3Presigner presigner, StorageProperties props, Clock clock) {
        this(presigner, null, props, clock);
    }

    public S3ObjectStorage(S3Presigner presigner, S3Client client, StorageProperties props, Clock clock) {
        this.presigner = presigner;
        this.client = client;
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

    @Override
    public void put(String key, String contentType, InputStream body, long length) {
        requireClient().putObject(PutObjectRequest.builder()
                .bucket(props.bucket())
                .key(key)
                .contentType(contentType)
                .contentLength(length)
                .build(),
            RequestBody.fromInputStream(body, length));
    }

    @Override
    public void putFile(String key, String contentType, Path file) {
        requireClient().putObject(PutObjectRequest.builder()
                .bucket(props.bucket())
                .key(key)
                .contentType(contentType)
                .build(),
            RequestBody.fromFile(file));
    }

    @Override
    public byte[] get(String key) {
        try {
            return requireClient().getObjectAsBytes(GetObjectRequest.builder().bucket(props.bucket()).key(key).build())
                .asByteArray();
        } catch (software.amazon.awssdk.services.s3.model.NoSuchKeyException e) {
            return null;
        }
    }

    @Override
    public void delete(String key) {
        requireClient().deleteObject(DeleteObjectRequest.builder().bucket(props.bucket()).key(key).build());
    }

    @Override
    public String presignGet(String key, Duration ttl, String filename, boolean inline, String contentType) {
        var get = GetObjectRequest.builder().bucket(props.bucket()).key(key);
        boolean named = filename != null && !filename.isBlank();
        if (inline || named) get.responseContentDisposition(disposition(inline ? "inline" : "attachment", filename));
        if (contentType != null) get.responseContentType(contentType);
        return presigner.presignGetObject(GetObjectPresignRequest.builder()
                .signatureDuration(ttl)
                .getObjectRequest(get.build())
                .build())
            .url().toString();
    }

    static String attachment(String filename) {
        return disposition("attachment", filename);
    }

    // RFC 6266/5987: an ASCII fallback plus the UTF-8 name.
    static String disposition(String type, String filename) {
        if (filename == null || filename.isBlank()) return type;
        var ascii = filename.replaceAll("[^A-Za-z0-9._ -]", "_");
        var encoded = URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20");
        return type + "; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded;
    }

    private S3Client requireClient() {
        if (client == null) throw new IllegalStateException("S3ObjectStorage built without an S3Client");
        return client;
    }
}
