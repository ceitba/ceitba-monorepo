package org.ceitba.api.service.mail;

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
import java.util.UUID;

// Signed, short-lived OAuth `state` of the sender-account connect flow; binds
// the staff user who started it.
//   state = b64url(userId|expiresAtEpochSec|nonce) + "." + b64url(HMAC-SHA256)
// The key is the JWT secret under its own domain prefix, so this can never be
// confused with a login state or a session JWT.
@Service
public class MailOAuthStateService {

    public static final Duration TTL = Duration.ofMinutes(10);

    private static final String DOMAIN = "ceitba-mail-oauth-state:";
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();

    private final SecretKeySpec key;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public MailOAuthStateService(AuthProperties auth, Clock clock) {
        Assert.notNull(auth.jwt(), "auth.jwt must be configured");
        Assert.hasText(auth.jwt().secret(), "auth.jwt.secret (AUTH_JWT_SECRET) must not be empty");
        this.key = new SecretKeySpec(Base64.getDecoder().decode(auth.jwt().secret()), "HmacSHA256");
        this.clock = clock;
    }

    public String issue(UUID staffUserId) {
        byte[] n = new byte[12];
        random.nextBytes(n);
        String payload = staffUserId + "|" + clock.instant().plus(TTL).getEpochSecond() + "|" + B64.encodeToString(n);
        return B64.encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + "." + B64.encodeToString(sign(payload));
    }

    // The staff user bound to `state` when it is authentic and unexpired.
    public Optional<UUID> verify(String state) {
        if (state == null) return Optional.empty();
        int dot = state.indexOf('.');
        if (dot <= 0 || dot == state.length() - 1) return Optional.empty();
        try {
            String payload = new String(B64D.decode(state.substring(0, dot)), StandardCharsets.UTF_8);
            if (!MessageDigest.isEqual(B64D.decode(state.substring(dot + 1)), sign(payload))) return Optional.empty();
            String[] parts = payload.split("\\|", 3);
            if (parts.length != 3) return Optional.empty();
            if (clock.instant().getEpochSecond() > Long.parseLong(parts[1])) return Optional.empty();
            return Optional.of(UUID.fromString(parts[0]));
        } catch (IllegalArgumentException e) {
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
