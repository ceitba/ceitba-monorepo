package org.ceitba.api.service.crypto;

import org.ceitba.api.config.AuthProperties;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// Keyed hashes over content identifiers (attachment keys, imported comment
// ids) that must be stable, unguessable and never reveal a user id, and over
// client IPs (vote dedup fingerprints, analytics visitor hashes): an unkeyed
// SHA-256 of an IPv4 address is reversible by enumerating all 2^32 inputs,
// a keyed one is not without the secret.
//
// Each purpose has its own key, derived from a root secret as
//   key(label) = HMAC-SHA256(root, "ceitba-content-hmac:v1:" + label)
// (a single-block HKDF-Expand), so no purpose shares a key with another and
// the JWT signing key is never used directly as an HMAC key for content.
//
// Root secret: content.hmac-secret (CONTENT_HMAC_SECRET, any string of at
// least 32 bytes, e.g. `openssl rand -base64 32`) when set; otherwise the
// base64-decoded AUTH_JWT_SECRET. Either way the derived keys change when the
// root changes: rotating AUTH_JWT_SECRET without a CONTENT_HMAC_SECRET
// invalidates every unattached proposal upload key, makes a Firestore
// import re-run duplicate legacy comments, lets every past article voter vote
// once more and splits analytics unique-visitor counts across the change.
// Set CONTENT_HMAC_SECRET to rotate the JWT secret independently; changing it
// later has the same effects.
@Component
public class ContentHmac {

    public static final String PROPOSAL_ATTACHMENT_KEYS = "proposal-attachment-keys";
    public static final String FIRESTORE_COMMENT_IDS = "firestore-comment-ids";
    public static final String VOTE_FINGERPRINTS = "vote-fingerprints";
    public static final String ANALYTICS_IP_HASHES = "analytics-ip-hashes";

    static final int MIN_DEDICATED_SECRET_BYTES = 32;
    private static final String ALGORITHM = "HmacSHA256";
    private static final String LABEL_PREFIX = "ceitba-content-hmac:v1:";

    private final byte[] root;
    private final Map<String, byte[]> derived = new ConcurrentHashMap<>();

    @Autowired
    public ContentHmac(AuthProperties auth, @Value("${content.hmac-secret:}") String dedicatedSecret) {
        this.root = rootSecret(auth.jwt() == null ? null : auth.jwt().secret(), dedicatedSecret);
    }

    public static ContentHmac fromJwtSecret(String base64JwtSecret) {
        return new ContentHmac(base64JwtSecret, null);
    }

    ContentHmac(String base64JwtSecret, String dedicatedSecret) {
        this.root = rootSecret(base64JwtSecret, dedicatedSecret);
    }

    // HMAC-SHA256 of `message` under the key derived for `label`.
    public byte[] sign(String label, String message) {
        return hmac(derived.computeIfAbsent(label, l -> hmac(root, LABEL_PREFIX + l)), message);
    }

    // Lower-case hex of sign(label, message) — 64 chars, same shape as the
    // SHA-256 hex digests it replaces in TEXT columns.
    public String signHex(String label, String message) {
        return HexFormat.of().formatHex(sign(label, message));
    }

    private static byte[] rootSecret(String base64JwtSecret, String dedicatedSecret) {
        if (dedicatedSecret != null && !dedicatedSecret.isBlank()) {
            byte[] bytes = dedicatedSecret.getBytes(StandardCharsets.UTF_8);
            if (bytes.length < MIN_DEDICATED_SECRET_BYTES) {
                throw new IllegalStateException(
                    "content.hmac-secret must be at least " + MIN_DEDICATED_SECRET_BYTES + " bytes");
            }
            return bytes;
        }
        if (base64JwtSecret == null || base64JwtSecret.isBlank()) {
            throw new IllegalStateException("auth.jwt.secret (or content.hmac-secret) is required");
        }
        return Base64.getDecoder().decode(base64JwtSecret);
    }

    private static byte[] hmac(byte[] key, String message) {
        try {
            var mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(key, ALGORITHM));
            return mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(ALGORITHM + " unavailable", e);
        }
    }
}
