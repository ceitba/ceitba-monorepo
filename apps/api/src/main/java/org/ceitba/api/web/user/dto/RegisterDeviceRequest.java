package org.ceitba.api.web.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

// PUT /v1/me/devices. `token` is the FCM registration token of this app
// install; `platform` is "ios" or "android" (case-insensitive).
public record RegisterDeviceRequest(
    @NotBlank @Size(max = RegisterDeviceRequest.MAX_TOKEN_LENGTH)
    @Pattern(regexp = RegisterDeviceRequest.TOKEN_PATTERN) String token,
    @NotBlank @Pattern(regexp = "(?i)ios|android") String platform,
    @Size(max = 32) String appVersion
) {
    // FCM tokens are URL-safe base64 plus ':' separators. Restricting the
    // alphabet keeps them safe to send back in DELETE /v1/me/devices/{token}.
    public static final String TOKEN_PATTERN = "[A-Za-z0-9_:.\\-]+";
    // Matches user_devices.token (V23). Real FCM tokens are ~150-250 chars.
    public static final int MAX_TOKEN_LENGTH = 1024;
}
