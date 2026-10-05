package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.web.kb.admin.KbEndpointDtos;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class KbSecretCipherTest {

    static final String ENV_KEY = Base64.getEncoder().encodeToString(new byte[32]);

    @Test
    void roundTripsWithTheJwtDerivedKeyAndNeverShowsThePlaintext() throws Exception {
        var c = new KbSecretCipher("", "jwt-secret-of-the-api");
        var stored = c.encrypt("sk-my-gpu-token");
        assertThat(stored).startsWith("v1:jwt:").doesNotContain("sk-my-gpu-token");
        assertThat(c.encrypt("sk-my-gpu-token")).isNotEqualTo(stored);   // random IV
        assertThat(c.decrypt(stored)).isEqualTo("sk-my-gpu-token");

        // The API item only says hasKey / keyReadable.
        var item = new KbEndpointDtos.Item(UUID.randomUUID(), "gpu", "http://h/v1", true, c.readable(stored), 2, 600,
            true, 0, OffsetDateTime.now(), OffsetDateTime.now());
        var out = new ObjectMapper().findAndRegisterModules().writeValueAsString(item);
        assertThat(out).contains("\"hasKey\":true").doesNotContain("sk-my-gpu-token").doesNotContain("apiKey");
    }

    @Test
    void oldTokensSurviveSettingTheEnvKeyAndRotationMakesThemUnreadable() {
        var jwtOnly = new KbSecretCipher("", "jwt-secret-of-the-api");
        var old = jwtOnly.encrypt("tok");

        var withEnv = new KbSecretCipher(ENV_KEY, "jwt-secret-of-the-api");
        assertThat(withEnv.decrypt(old)).isEqualTo("tok");
        assertThat(withEnv.encrypt("tok2")).startsWith("v1:env:");

        var rotated = new KbSecretCipher("", "another-secret");
        assertThat(rotated.readable(old)).isFalse();
        assertThatThrownBy(() -> rotated.decrypt(old)).isInstanceOf(KbSecretCipher.KeyUnreadableException.class)
            .hasMessageContaining("re-enter");
        assertThat(rotated.readable(null)).isTrue();
    }
}
