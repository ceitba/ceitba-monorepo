package org.ceitba.api.web.auth.dto;

// Optional body of POST /v1/auth/logout. When refreshToken is present its
// whole family is revoked (mobile logout); the web cookie is cleared either way.
public record LogoutRequest(String refreshToken) {}
