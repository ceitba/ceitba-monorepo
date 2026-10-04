package org.ceitba.api.service.digest;

import org.ceitba.api.service.crypto.ContentHmac;
import org.springframework.stereotype.Component;

import java.security.MessageDigest;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;

// One-click unsubscribe tokens: "<userId>.<base64url HMAC>". The key is
// ContentHmac's DIGEST_UNSUBSCRIBE purpose key (derived from
// CONTENT_HMAC_SECRET, else AUTH_JWT_SECRET, with its own label), so it is
// never the JWT signing key and is scoped to this one use. Tokens do not
// expire (old emails keep working); rotating the root secret invalidates them.
@Component
public class DigestUnsubscribeTokens {

    private static final String MESSAGE_PREFIX = "digest-unsubscribe:v1:";
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    private final ContentHmac hmac;

    public DigestUnsubscribeTokens(ContentHmac hmac) {
        this.hmac = hmac;
    }

    public String issue(UUID userId) {
        return userId + "." + B64.encodeToString(mac(userId));
    }

    public Optional<UUID> verify(String token) {
        if (token == null) return Optional.empty();
        int dot = token.indexOf('.');
        if (dot <= 0 || dot != token.lastIndexOf('.')) return Optional.empty();
        UUID userId;
        byte[] given;
        try {
            userId = UUID.fromString(token.substring(0, dot));
            given = Base64.getUrlDecoder().decode(token.substring(dot + 1));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        // Canonical form only (UUID.fromString accepts odd spellings).
        if (!userId.toString().equals(token.substring(0, dot))) return Optional.empty();
        return MessageDigest.isEqual(mac(userId), given) ? Optional.of(userId) : Optional.empty();
    }

    private byte[] mac(UUID userId) {
        return hmac.sign(ContentHmac.DIGEST_UNSUBSCRIBE, MESSAGE_PREFIX + userId);
    }
}
