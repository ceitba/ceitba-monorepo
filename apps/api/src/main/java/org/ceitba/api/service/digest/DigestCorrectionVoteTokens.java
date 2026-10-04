package org.ceitba.api.service.digest;

import org.ceitba.api.config.DigestPersonalProperties;
import org.ceitba.api.service.crypto.ContentHmac;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

// Links of the digest's "¿Es así?" schedule-correction prompts:
// "<userId>.<correctionId>.<expiresAtEpochSeconds>.<base64url HMAC>".
// The key is ContentHmac's DIGEST_CORRECTION_VOTE purpose key (same
// derivation as the unsubscribe tokens, its own label), so a token of one
// purpose never verifies as the other. A token only names who may vote on
// which correction until when; the vote itself (confirm/reject) is chosen on
// the page and POSTed, never taken from the link.
@Component
public class DigestCorrectionVoteTokens {

    private static final String MESSAGE_PREFIX = "digest-correction-vote:v1:";
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    public sealed interface Verified permits Valid, Expired, Invalid {}

    public record Valid(UUID userId, UUID correctionId, Instant expiresAt) implements Verified {}

    public record Expired() implements Verified {}

    public record Invalid() implements Verified {}

    private final ContentHmac hmac;
    private final Clock clock;
    private final Duration ttl;

    @Autowired
    public DigestCorrectionVoteTokens(ContentHmac hmac, Clock clock, DigestPersonalProperties props) {
        this(hmac, clock, props.voteTokenTtl());
    }

    public DigestCorrectionVoteTokens(ContentHmac hmac, Clock clock, Duration ttl) {
        this.hmac = hmac;
        this.clock = clock;
        this.ttl = ttl;
    }

    public String issue(UUID userId, UUID correctionId) {
        long exp = clock.instant().plus(ttl).getEpochSecond();
        return userId + "." + correctionId + "." + exp + "." + B64.encodeToString(mac(userId, correctionId, exp));
    }

    // The MAC is checked before the expiry, so Expired is only ever said of a
    // token we issued.
    public Verified verify(String token) {
        if (token == null || token.length() > 200) return new Invalid();
        String[] parts = token.split("\\.", -1);
        if (parts.length != 4) return new Invalid();
        UUID userId;
        UUID correctionId;
        long exp;
        byte[] given;
        try {
            userId = UUID.fromString(parts[0]);
            correctionId = UUID.fromString(parts[1]);
            if (!parts[2].matches("\\d{1,12}")) return new Invalid();
            exp = Long.parseLong(parts[2]);
            given = Base64.getUrlDecoder().decode(parts[3]);
        } catch (IllegalArgumentException e) {
            return new Invalid();
        }
        // Canonical form only (UUID.fromString accepts odd spellings).
        if (!userId.toString().equals(parts[0]) || !correctionId.toString().equals(parts[1])) return new Invalid();
        if (!MessageDigest.isEqual(mac(userId, correctionId, exp), given)) return new Invalid();
        Instant expiresAt = Instant.ofEpochSecond(exp);
        if (!clock.instant().isBefore(expiresAt)) return new Expired();
        return new Valid(userId, correctionId, expiresAt);
    }

    private byte[] mac(UUID userId, UUID correctionId, long exp) {
        return hmac.sign(ContentHmac.DIGEST_CORRECTION_VOTE, MESSAGE_PREFIX + userId + ":" + correctionId + ":" + exp);
    }
}
