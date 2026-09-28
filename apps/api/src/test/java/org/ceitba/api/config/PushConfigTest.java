package org.ceitba.api.config;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

class PushConfigTest {

    private static String read(PushProperties p) throws Exception {
        try (var in = PushConfig.open(p)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    void notConfiguredWhenBothAreBlank() {
        assertThat(new PushProperties(null, " ").configured()).isFalse();
        assertThat(new PushProperties("{}", null).configured()).isTrue();
        assertThat(new PushProperties(null, "/x.json").configured()).isTrue();
    }

    @Test
    void readsRawJson() throws Exception {
        assertThat(read(new PushProperties("  {\"a\":1}  ", null))).isEqualTo("{\"a\":1}");
    }

    @Test
    void readsBase64Json() throws Exception {
        var b64 = Base64.getEncoder().encodeToString("{\"a\":1}".getBytes(StandardCharsets.UTF_8));
        assertThat(read(new PushProperties(b64, null))).isEqualTo("{\"a\":1}");
    }

    @Test
    void readsAFileAndJsonWinsOverPath() throws Exception {
        var f = Files.createTempFile("sa", ".json");
        try {
            Files.writeString(f, "{\"file\":true}");
            assertThat(read(new PushProperties(null, f.toString()))).isEqualTo("{\"file\":true}");
            assertThat(read(new PushProperties("{\"env\":true}", f.toString()))).isEqualTo("{\"env\":true}");
        } finally {
            Files.deleteIfExists(f);
        }
    }
}
