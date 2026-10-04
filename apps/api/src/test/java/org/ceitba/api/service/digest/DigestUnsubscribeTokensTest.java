package org.ceitba.api.service.digest;

import org.ceitba.api.service.crypto.ContentHmac;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class DigestUnsubscribeTokensTest {

    static final String SECRET = "dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch";
    final DigestUnsubscribeTokens tokens = new DigestUnsubscribeTokens(ContentHmac.fromJwtSecret(SECRET));

    @Test
    void roundTrip() {
        var id = UUID.randomUUID();
        assertThat(tokens.verify(tokens.issue(id))).contains(id);
    }

    @Test
    void rejectsTamperedOrForeignTokens() {
        var id = UUID.randomUUID();
        String token = tokens.issue(id);
        String mac = token.substring(token.indexOf('.') + 1);
        // Same MAC, other user.
        assertThat(tokens.verify(UUID.randomUUID() + "." + mac)).isEmpty();
        // Flipped MAC character.
        char c = mac.charAt(0) == 'A' ? 'B' : 'A';
        assertThat(tokens.verify(id + "." + c + mac.substring(1))).isEmpty();
        // Signed with another secret.
        var other = new DigestUnsubscribeTokens(ContentHmac.fromJwtSecret("b3RoZXItc2VjcmV0LW90aGVyLXNlY3JldC0zMmJ5dGVz"));
        assertThat(tokens.verify(other.issue(id))).isEmpty();
    }

    @Test
    void rejectsMalformed() {
        assertThat(tokens.verify(null)).isEmpty();
        assertThat(tokens.verify("")).isEmpty();
        assertThat(tokens.verify("not-a-token")).isEmpty();
        assertThat(tokens.verify("x.y")).isEmpty();
        assertThat(tokens.verify(UUID.randomUUID() + ".%%%")).isEmpty();
        assertThat(tokens.verify(tokens.issue(UUID.randomUUID()) + ".extra")).isEmpty();
    }

    @Test
    void notTheSameKeyAsOtherPurposes() {
        var hmac = ContentHmac.fromJwtSecret(SECRET);
        var id = UUID.randomUUID();
        assertThat(hmac.signHex(ContentHmac.DIGEST_UNSUBSCRIBE, "x"))
            .isNotEqualTo(hmac.signHex(ContentHmac.VOTE_FINGERPRINTS, "x"));
        assertThat(tokens.issue(id)).startsWith(id + ".");
    }
}
