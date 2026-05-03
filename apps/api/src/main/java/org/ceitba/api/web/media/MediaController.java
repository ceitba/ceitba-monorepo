package org.ceitba.api.web.media;

import jakarta.validation.Valid;
import org.ceitba.api.web.media.dto.SignUploadRequest;
import org.ceitba.api.web.media.dto.SignUploadResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Set;
import java.util.UUID;

// TODO: wire up a real S3/R2 presigned URL generator when cloud storage is configured.
// Required env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_URL
// (or the AWS equivalents). Until then this endpoint returns 501.
@RestController
@RequestMapping("/v1/media")
public class MediaController {

    private static final Set<String> ALLOWED_TYPES = Set.of(
        "image/jpeg", "image/png", "image/webp"
    );
    private static final long MAX_SIZE = 5 * 1024 * 1024; // 5 MB

    @PostMapping("/sign-upload")
    @PreAuthorize("hasRole('STAFF')")
    public SignUploadResponse signUpload(@RequestBody @Valid SignUploadRequest req) {
        if (!ALLOWED_TYPES.contains(req.contentType())) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                "Unsupported content type. Allowed: image/jpeg, image/png, image/webp");
        }
        if (req.sizeBytes() > MAX_SIZE) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                "File too large. Maximum size is 5 MB");
        }
        // Presigned URL generation not yet implemented — awaiting cloud storage config.
        throw new ResponseStatusException(HttpStatus.NOT_IMPLEMENTED,
            "Cloud storage not configured. Set R2_* or AWS_* environment variables.");
    }
}
