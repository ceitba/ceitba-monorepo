package org.ceitba.api.web.media;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.media.MediaUploadService;
import org.ceitba.api.web.media.dto.SignUploadRequest;
import org.ceitba.api.web.media.dto.SignUploadResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Presigned direct-to-bucket uploads for STAFF CMS images (jpeg/png/webp,
// 5 MB). 501 when object storage (storage.*, R2_* env) is not configured.
// Proposal attachments have their own USER-scoped endpoint:
// POST /v1/proposals/attachments/sign-upload.
@Tag(name = "Media")
@RestController
@RequestMapping("/v1/media")
public class MediaController {

    private final MediaUploadService uploads;

    public MediaController(MediaUploadService uploads) {
        this.uploads = uploads;
    }

    @PostMapping("/sign-upload")
    @PreAuthorize("hasRole('STAFF')")
    @Operation(summary = "Sign a PUT upload of a CMS image (STAFF)")
    public SignUploadResponse signUpload(@RequestBody @Valid SignUploadRequest req) {
        return uploads.signStaffImage(req);
    }
}
