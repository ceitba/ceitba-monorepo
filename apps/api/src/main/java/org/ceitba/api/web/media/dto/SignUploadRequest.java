package org.ceitba.api.web.media.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

public record SignUploadRequest(
    @NotBlank String filename,
    @NotBlank String contentType,
    @Positive long   sizeBytes
) {}
