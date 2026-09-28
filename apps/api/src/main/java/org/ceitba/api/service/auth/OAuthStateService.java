package org.ceitba.api.service.auth;

import org.ceitba.api.config.AuthProperties;
import org.springframework.stereotype.Service;
import org.springframework.util.Assert;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.Optional;

// OAuth `state` for the Google web login flow. Protects the callback against
// login CSRF and tampering with the post-login redirect target.
//
// state = b64url(nonce|expiresAtEpochSec|target) + "." + b64url(HMAC-SHA256)
//
// The HMAC key is the JWT secret with a domain-separation prefix, so a state
// can never be confused with a session JWT. The nonce is also stored in a
// short-lived HttpOnly cookie by AuthController; the callback only proceeds
// when the signature is valid, the state has not expired, AND the cookie nonce
// matches — so a state minted in someone else's browser is useless.
@Service
public class OAuthStateService {

    public static final Duration TTL = Duration.ofMinutes(10);

    private static final String DOMAIN = "ceitba-oauth-state:";
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();

    private final SecretKeySpec key;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public OAuthStateService(AuthProperties auth, Clock clock) {
        Assert.notNull(auth.jwt(), "auth.jwt must be configured");
        Assert.hasText(auth.jwt().secret(), "auth.jwt.secret (AUTH_JWT_SECRET) must not be empty");
        this.key = new SecretKeySpec(Base64.getDecoder().decode(auth.jwt().secret()), "HmacSHA256");
        this.clock = clock;
    }

    public record IssuedState(String state, String nonce) {}

    public IssuedState issue(String target) {
        byte[] n = new byte[16];
        random.nextBytes(n);
        String nonce = B64.encodeToString(n);
        long exp = clock.instant().plus(TTL).getEpochSecond();
        String payload = nonce + "|" + exp + "|" + target;
        String state = B64.encodeToString(payload.getBytes(StandardCharsets.UTF_8))
            + "." + B64.encodeToString(sign(payload));
        return new IssuedState(state, nonce);
    }

    // Returns the redirect target encoded in `state` when it is authentic,
    // unexpired and bound to `cookieNonce`; empty otherwise.
    public Optional<String> verify(String state, String cookieNonce) {
        if (state == null || cookieNonce == null || cookieNonce.isBlank()) return Optional.empty();
        int dot = state.indexOf('.');
        if (dot <= 0 || dot == state.length() - 1) return Optional.empty();
        try {
            String payload = new String(B64D.decode(state.substring(0, dot)), StandardCharsets.UTF_8);
            byte[] sig = B64D.decode(state.substring(dot + 1));
            if (!MessageDigest.isEqual(sig, sign(payload))) return Optional.empty();

            String[] parts = payload.split("\\|", 3);
            if (parts.length != 3) return Optional.empty();
            if (!MessageDigest.isEqual(parts[0].getBytes(StandardCharsets.UTF_8),
                                       cookieNonce.getBytes(StandardCharsets.UTF_8))) {
                return Optional.empty();
            }
            if (clock.instant().getEpochSecond() > Long.parseLong(parts[1])) return Optional.empty();
            return Optional.of(parts[2]);
        } catch (IllegalArgumentException e) {
            // bad base64 / non-numeric expiry
            return Optional.empty();
        }
    }

    private byte[] sign(String payload) {
        try {
            var mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return mac.doFinal((DOMAIN + payload).getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", e);
        }
    }
}
