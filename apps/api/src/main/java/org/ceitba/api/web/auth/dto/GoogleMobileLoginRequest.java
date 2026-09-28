package org.ceitba.api.web.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

// idToken: Google ID token from the native Google Sign-In SDK, requested with
//          the API's web client ID as serverClientId (so aud matches).
// nonce:   optional; when sent, must equal the token's `nonce` claim.
// deviceName: optional label stored with the refresh-token family.
public record GoogleMobileLoginRequest(
    @NotBlank @Size(max = 8192) String idToken,
    @Size(max = 512) String nonce,
    @Size(max = 120) String deviceName
) {}
