package org.ceitba.api.service.orgmail;

import org.ceitba.api.service.crypto.ContentHmac;
import org.springframework.stereotype.Component;

import java.security.MessageDigest;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

// One-click unsubscribe from one organization's emails:
// "<userId>.<orgSlug>.<base64url HMAC>" (slugs are [a-z0-9-], never a dot).
// Keyed by ContentHmac's ORG_MAIL_UNSUBSCRIBE purpose; like the digest's,
// tokens don't expire, and a token only ever opts its user out of its org.
@Component
public class OrgMailUnsubscribeTokens {

    private static final String MESSAGE_PREFIX = "org-mail-unsubscribe:v1:";
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Pattern SLUG = Pattern.compile("^[a-z0-9]+(-[a-z0-9]+)*$");

    public record Subject(UUID userId, String orgSlug) {}

    private final ContentHmac hmac;

    public OrgMailUnsubscribeTokens(ContentHmac hmac) {
        this.hmac = hmac;
    }

    public String issue(UUID userId, String orgSlug) {
        return userId + "." + orgSlug + "." + B64.encodeToString(mac(userId, orgSlug));
    }

    public Optional<Subject> verify(String token) {
        if (token == null) return Optional.empty();
        String[] parts = token.split("\\.", -1);
        if (parts.length != 3 || !SLUG.matcher(parts[1]).matches()) return Optional.empty();
        UUID userId;
        byte[] given;
        try {
            userId = UUID.fromString(parts[0]);
            given = Base64.getUrlDecoder().decode(parts[2]);
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        // Canonical form only (UUID.fromString accepts odd spellings).
        if (!userId.toString().equals(parts[0])) return Optional.empty();
        return MessageDigest.isEqual(mac(userId, parts[1]), given)
            ? Optional.of(new Subject(userId, parts[1])) : Optional.empty();
    }

    private byte[] mac(UUID userId, String orgSlug) {
        return hmac.sign(ContentHmac.ORG_MAIL_UNSUBSCRIBE, MESSAGE_PREFIX + userId + ":" + orgSlug);
    }
}
