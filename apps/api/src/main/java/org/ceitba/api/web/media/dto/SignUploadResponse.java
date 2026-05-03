package org.ceitba.api.web.media.dto;

public record SignUploadResponse(
    String uploadUrl,
    String publicUrl,
    String key
) {}
