package org.ceitba.api.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.FileSystemResource;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

// storage.* in application.yml reads STORAGE_* first and falls back to the
// older R2_* names, so an existing .env keeps working after the rename.
class StorageEnvFallbackTest {

    private static StandardEnvironment envWith(Map<String, Object> vars) throws Exception {
        var env = new StandardEnvironment();
        env.getPropertySources().addFirst(new MapPropertySource("vars", vars));
        // The main file, not the classpath one: src/test/resources has its own
        // application.yml that shadows it. Surefire runs from the module root.
        var yml = new FileSystemResource("src/main/resources/application.yml");
        for (var ps : new YamlPropertySourceLoader().load("application", yml)) {
            env.getPropertySources().addLast(ps);
        }
        return env;
    }

    @Test
    void storageNamesWin() throws Exception {
        var env = envWith(Map.of(
            "STORAGE_ENDPOINT", "https://ceitba.org.ar", "R2_ENDPOINT", "https://old.r2",
            "STORAGE_BUCKET", "ceitba-media", "STORAGE_PUBLIC_URL", "https://ceitba.org.ar/ceitba-media",
            "STORAGE_PRESIGN_TTL", "5m"));
        assertThat(env.getProperty("storage.endpoint")).isEqualTo("https://ceitba.org.ar");
        assertThat(env.getProperty("storage.bucket")).isEqualTo("ceitba-media");
        assertThat(env.getProperty("storage.public-base-url")).isEqualTo("https://ceitba.org.ar/ceitba-media");
        assertThat(env.getProperty("storage.presign-ttl")).isEqualTo("5m");
        assertThat(env.getProperty("storage.region")).isEqualTo("us-east-1");
    }

    @Test
    void r2NamesAreFallbacks() throws Exception {
        var env = envWith(Map.of(
            "R2_ENDPOINT", "https://acct.r2.cloudflarestorage.com", "R2_REGION", "auto",
            "R2_BUCKET", "b", "R2_ACCESS_KEY_ID", "k", "R2_SECRET_ACCESS_KEY", "s",
            "R2_PUBLIC_URL", "https://media.test", "R2_PRESIGN_TTL", "3m"));
        assertThat(env.getProperty("storage.endpoint")).isEqualTo("https://acct.r2.cloudflarestorage.com");
        assertThat(env.getProperty("storage.region")).isEqualTo("auto");
        assertThat(env.getProperty("storage.bucket")).isEqualTo("b");
        assertThat(env.getProperty("storage.access-key-id")).isEqualTo("k");
        assertThat(env.getProperty("storage.secret-access-key")).isEqualTo("s");
        assertThat(env.getProperty("storage.public-base-url")).isEqualTo("https://media.test");
        assertThat(env.getProperty("storage.presign-ttl")).isEqualTo("3m");
    }

    @Test
    void unsetMeansEmpty() throws Exception {
        var env = envWith(Map.of());
        assertThat(env.getProperty("storage.endpoint")).isEmpty();
        assertThat(env.getProperty("storage.presign-ttl")).isEqualTo("10m");
    }
}
