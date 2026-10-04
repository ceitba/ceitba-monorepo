package org.ceitba.api.service.mail;

import org.junit.jupiter.api.Test;

import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MailTokenCipherTest {

    static final String KEY = Base64.getEncoder().encodeToString(new byte[32]);
    static final String OTHER_KEY = Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef".getBytes());

    private final MailTokenCipher cipher = new MailTokenCipher(KEY);

    @Test
    void roundTripWithFreshIvEachTime() {
        String a = cipher.encrypt("1//refresh-token", "ceitba@itba.edu.ar");
        String b = cipher.encrypt("1//refresh-token", "ceitba@itba.edu.ar");
        assertThat(a).isNotEqualTo(b).doesNotContain("refresh-token");
        assertThat(cipher.decrypt(a, "ceitba@itba.edu.ar")).isEqualTo("1//refresh-token");
        assertThat(cipher.decrypt(a, "CEITBA@itba.edu.ar")).isEqualTo("1//refresh-token");   // aad is case-insensitive
    }

    @Test
    void tamperingWrongKeyAndWrongAccountAreRejected() {
        String enc = cipher.encrypt("secret", "ceitba@itba.edu.ar");
        byte[] raw = Base64.getDecoder().decode(enc);
        raw[raw.length - 1] ^= 1;
        String tampered = Base64.getEncoder().encodeToString(raw);
        assertThatThrownBy(() -> cipher.decrypt(tampered, "ceitba@itba.edu.ar"))
            .isInstanceOf(MailTokenCipher.TokenDecryptionException.class);
        assertThatThrownBy(() -> new MailTokenCipher(OTHER_KEY).decrypt(enc, "ceitba@itba.edu.ar"))
            .isInstanceOf(MailTokenCipher.TokenDecryptionException.class);
        assertThatThrownBy(() -> cipher.decrypt(enc, "someone@itba.edu.ar"))
            .isInstanceOf(MailTokenCipher.TokenDecryptionException.class);
        assertThatThrownBy(() -> cipher.decrypt("not base64 !", "x"))
            .isInstanceOf(MailTokenCipher.TokenDecryptionException.class);
    }

    @Test
    void keyMustBe32Bytes() {
        assertThatThrownBy(() -> new MailTokenCipher(Base64.getEncoder().encodeToString(new byte[16])))
            .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new MailTokenCipher("")).isInstanceOf(IllegalStateException.class);
    }
}
