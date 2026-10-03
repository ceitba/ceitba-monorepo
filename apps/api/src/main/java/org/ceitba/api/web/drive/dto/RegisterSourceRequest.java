package org.ceitba.api.web.drive.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterSourceRequest(
    @NotBlank @Size(max = 2048) String folderUrl,
    @NotBlank @Size(max = 32) String consentVersion,
    boolean anonymous
) {}
