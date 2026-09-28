package org.ceitba.api.service.auth;

import org.ceitba.api.service.auth.GoogleOAuthService.IdTokenClaims;

// Verifies a Google ID token handed to us by a native client (signature via
// Google's JWKS, iss, aud, exp, optional nonce) and returns its claims.
// An interface so integration tests can substitute a verifier backed by a
// local key instead of Google's JWKS endpoint.
public interface GoogleIdTokenVerifier {

    // @param expectedNonce nonce the client passed to Google Sign-In, or null
    //                      when the client did not use one.
    // @throws InvalidTokenException if the token fails any check.
    IdTokenClaims verify(String idToken, String expectedNonce);
}
