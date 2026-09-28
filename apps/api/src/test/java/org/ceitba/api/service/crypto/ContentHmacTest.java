package org.ceitba.api.service.crypto;

import org.ceitba.api.config.AuthProperties;
import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ContentHmacTest {

    private static final String JWT_SECRET = "dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch";
    private static final String DEDICATED = "a-dedicated-content-secret-of-32+-bytes";

    private static AuthProperties auth(String jwtSecret) {
        return new AuthProperties(List.of(), List.of(), null, null,
            new AuthProperties.Jwt(jwtSecret, 1, null, null, null, null, null), null, null);
    }

    private static byte[] rawHmac(byte[] key, String message) throws Exception {
        var mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void neverUsesTheJwtSigningKeyDirectly() throws Exception {
        var hmac = new ContentHmac(auth(JWT_SECRET), "");
        byte[] jwtKey = Base64.getDecoder().decode(JWT_SECRET);

        assertThat(hmac.sign(ContentHmac.PROPOSAL_ATTACHMENT_KEYS, "m")).isNotEqualTo(rawHmac(jwtKey, "m"));
        assertThat(hmac.sign(ContentHmac.FIRESTORE_COMMENT_IDS, "m")).isNotEqualTo(rawHmac(jwtKey, "m"));
        // The derivation documented in ContentHmac.
        byte[] derived = rawHmac(jwtKey, "ceitba-content-hmac:v1:" + ContentHmac.PROPOSAL_ATTACHMENT_KEYS);
        assertThat(hmac.sign(ContentHmac.PROPOSAL_ATTACHMENT_KEYS, "m")).isEqualTo(rawHmac(derived, "m"));
    }

    @Test
    void eachLabelHasItsOwnKeyAndResultsAreStable() {
        var hmac = ContentHmac.fromJwtSecret(JWT_SECRET);
        assertThat(hmac.sign(ContentHmac.PROPOSAL_ATTACHMENT_KEYS, "m"))
            .isNotEqualTo(hmac.sign(ContentHmac.FIRESTORE_COMMENT_IDS, "m"))
            .isEqualTo(ContentHmac.fromJwtSecret(JWT_SECRET).sign(ContentHmac.PROPOSAL_ATTACHMENT_KEYS, "m"));
    }

    @Test
    void dedicatedSecretTakesPrecedenceOverTheJwtSecret() throws Exception {
        var jwtOnly = new ContentHmac(auth(JWT_SECRET), null);
        var dedicated = new ContentHmac(auth(JWT_SECRET), DEDICATED);
        var dedicatedOtherJwt = new ContentHmac(auth("b3RoZXItand0LXNlY3JldC1rZXktMzJieXRlcy1sb25nIQ=="), DEDICATED);

        String label = ContentHmac.FIRESTORE_COMMENT_IDS;
        assertThat(dedicated.sign(label, "m")).isNotEqualTo(jwtOnly.sign(label, "m"));
        // Rotating the JWT secret does not change keys derived from a dedicated secret.
        assertThat(dedicatedOtherJwt.sign(label, "m")).isEqualTo(dedicated.sign(label, "m"));
        byte[] derived = rawHmac(DEDICATED.getBytes(StandardCharsets.UTF_8), "ceitba-content-hmac:v1:" + label);
        assertThat(dedicated.sign(label, "m")).isEqualTo(rawHmac(derived, "m"));
    }

    @Test
    void rejectsShortDedicatedSecretAndMissingSecrets() {
        assertThatThrownBy(() -> new ContentHmac(auth(JWT_SECRET), "too-short"))
            .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new ContentHmac(auth(""), " "))
            .isInstanceOf(IllegalStateException.class);
        // A dedicated secret alone is enough.
        assertThat(new ContentHmac(auth(null), DEDICATED).sign("x", "m")).hasSize(32);
    }
}
