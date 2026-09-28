package org.ceitba.api.web.auth.dto;

// POST /v1/auth/review-login. Validated in ReviewLoginService, not with bean
// validation (see TokenAuthController). deviceName is optional and stored with
// the refresh-token family like on the Google login.
public record ReviewLoginRequest(String email, String password, String deviceName) {
    public ReviewLoginRequest {
        if (deviceName != null && deviceName.length() > 120) deviceName = deviceName.substring(0, 120);
    }
}
