package org.ceitba.api.web.auth.dto;

import java.time.Instant;

// Returned by POST /v1/auth/google/mobile and POST /v1/auth/refresh.
// accessToken goes in `Authorization: Bearer`; refreshToken is single-use and
// must be replaced by the one in each refresh response.
public record TokenResponse(
    String accessToken,
    Instant accessTokenExpiresAt,
    String refreshToken,
    Instant refreshTokenExpiresAt,
    UserMeResponse user
) {}
