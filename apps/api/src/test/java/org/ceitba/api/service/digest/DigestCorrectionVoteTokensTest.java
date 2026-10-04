package org.ceitba.api.service.digest;

import org.ceitba.api.service.crypto.ContentHmac;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class DigestCorrectionVoteTokensTest {

    static final String SECRET = "dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch";
    static final Instant NOW = Instant.parse("2026-10-05T15:00:00Z");
    final ContentHmac hmac = ContentHmac.fromJwtSecret(SECRET);

    DigestCorrectionVoteTokens at(Instant now) {
        return new DigestCorrectionVoteTokens(hmac, Clock.fixed(now, ZoneOffset.UTC), Duration.ofDays(14));
    }

    @Test
    void roundTripCarriesUserCorrectionAndExpiry() {
        var user = UUID.randomUUID();
        var correction = UUID.randomUUID();
        var v = at(NOW).verify(at(NOW).issue(user, correction));
        assertThat(v).isEqualTo(new DigestCorrectionVoteTokens.Valid(user, correction, NOW.plus(Duration.ofDays(14))));
    }

    @Test
    void expiresAfterTheTtl() {
        String token = at(NOW).issue(UUID.randomUUID(), UUID.randomUUID());
        assertThat(at(NOW.plus(Duration.ofDays(14)).minusSeconds(1)).verify(token))
            .isInstanceOf(DigestCorrectionVoteTokens.Valid.class);
        assertThat(at(NOW.plus(Duration.ofDays(14))).verify(token)).isInstanceOf(DigestCorrectionVoteTokens.Expired.class);
    }

    @Test
    void rejectsTamperedForeignAndMalformedTokens() {
        var user = UUID.randomUUID();
        var correction = UUID.randomUUID();
        String token = at(NOW).issue(user, correction);
        String[] p = token.split("\\.");
        var tokens = at(NOW);
        // Other user, other correction, extended expiry: MAC no longer matches.
        assertThat(tokens.verify(UUID.randomUUID() + "." + p[1] + "." + p[2] + "." + p[3])).isInstanceOf(DigestCorrectionVoteTokens.Invalid.class);
        assertThat(tokens.verify(p[0] + "." + UUID.randomUUID() + "." + p[2] + "." + p[3])).isInstanceOf(DigestCorrectionVoteTokens.Invalid.class);
        assertThat(tokens.verify(p[0] + "." + p[1] + "." + (Long.parseLong(p[2]) + 86400) + "." + p[3])).isInstanceOf(DigestCorrectionVoteTokens.Invalid.class);
        // An expired-looking forged token is Invalid, not Expired.
        assertThat(tokens.verify(p[0] + "." + p[1] + ".1." + p[3])).isInstanceOf(DigestCorrectionVoteTokens.Invalid.class);
        // Another secret.
        var other = new DigestCorrectionVoteTokens(ContentHmac.fromJwtSecret("b3RoZXItc2VjcmV0LW90aGVyLXNlY3JldC0zMmJ5dGVz"),
            Clock.fixed(NOW, ZoneOffset.UTC), Duration.ofDays(14));
        assertThat(tokens.verify(other.issue(user, correction))).isInstanceOf(DigestCorrectionVoteTokens.Invalid.class);
        for (String bad : new String[]{null, "", "x", "a.b.c.d", token + ".x", p[0] + "." + p[1] + ".-5." + p[3],
                p[0].toUpperCase() + "." + p[1] + "." + p[2] + "." + p[3], p[0] + "." + p[1] + "." + p[2] + ".%%%"}) {
            assertThat(tokens.verify(bad)).as(String.valueOf(bad)).isInstanceOf(DigestCorrectionVoteTokens.Invalid.class);
        }
    }

    @Test
    void anUnsubscribeTokenIsNotAVoteToken() {
        var user = UUID.randomUUID();
        String unsub = new DigestUnsubscribeTokens(hmac).issue(user);
        assertThat(at(NOW).verify(unsub)).isInstanceOf(DigestCorrectionVoteTokens.Invalid.class);
        assertThat(hmac.signHex(ContentHmac.DIGEST_CORRECTION_VOTE, "x"))
            .isNotEqualTo(hmac.signHex(ContentHmac.DIGEST_UNSUBSCRIBE, "x"));
    }
}
