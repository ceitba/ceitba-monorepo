package org.ceitba.api.web.media;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.config.StorageConfig;
import org.ceitba.api.config.StorageProperties;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.Network;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.startupcheck.OneShotStartupCheckStrategy;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.images.builder.Transferable;
import org.yaml.snakeyaml.Yaml;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.DeleteObjectPresignRequest;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// End-to-end proof of the production upload path, with the real pieces:
//
//   phone --PUT presigned URL--> Caddy (/ceitba-media/*) --> MinIO
//   phone --GET public URL-----> Caddy (/ceitba-media/*) --> MinIO (anonymous)
//
// The MinIO and mc images and the bucket/user setup script are read from the
// repo's docker-compose.yml (minio, minio-init), and the Caddy route is the
// `handle /ceitba-media/*` block of infrastructure/caddy/Caddyfile, so this
// test breaks if either drifts. The API signs for the proxy's address
// (localhost:<mapped port>) while MinIO listens as ceitba-minio:9000: the
// signature validates only because Caddy forwards the client's Host header
// unchanged, exactly as in prod (Host: ceitba.org.ar).
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class MinioPresignedUploadIT {

    static final String BUCKET = "ceitba-media";
    static final String ROOT_USER = "ceitba-root";
    static final String ROOT_PASSWORD = "root-password-for-tests";
    // Same name as the policy, as in .env.example: the script must not mistake
    // the user name for an attached policy.
    static final String SERVICE_KEY = "ceitba-api";
    static final String SERVICE_SECRET = "service-secret-for-tests";

    static final Network NET = Network.newNetwork();
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    static final GenericContainer<?> MINIO;
    static final GenericContainer<?> CADDY;

    static {
        var compose = service(Path.of("docker-compose.yml"), "minio");
        var init = service(Path.of("docker-compose.yml"), "minio-init");
        var caddyImage = (String) service(Path.of("infrastructure/caddy/docker-compose.yml"), "caddy").get("image");

        MINIO = new GenericContainer<>((String) compose.get("image"))
            .withNetwork(NET)
            .withNetworkAliases("ceitba-minio", "minio")
            .withEnv("MINIO_ROOT_USER", ROOT_USER)
            .withEnv("MINIO_ROOT_PASSWORD", ROOT_PASSWORD)
            .withCommand(strings(compose.get("command")).toArray(String[]::new))
            .withExposedPorts(9000)
            .waitingFor(Wait.forHttp("/minio/health/live").forPort(9000));

        // The compose script, with Compose's $$ escape undone.
        List<String> script = new ArrayList<>(strings(init.get("command")));
        script.replaceAll(s -> s.replace("$$", "$"));
        var mc = new GenericContainer<>((String) init.get("image"))
            .withNetwork(NET)
            .withEnv("MC_CONFIG_DIR", "/tmp/.mc")
            .withEnv("MINIO_URL", "http://minio:9000")
            .withEnv("MINIO_ROOT_USER", ROOT_USER)
            .withEnv("MINIO_ROOT_PASSWORD", ROOT_PASSWORD)
            .withEnv("STORAGE_BUCKET", BUCKET)
            .withEnv("STORAGE_ACCESS_KEY_ID", SERVICE_KEY)
            .withEnv("STORAGE_SECRET_ACCESS_KEY", SERVICE_SECRET)
            .withCreateContainerCmdModifier(c -> c.withEntrypoint(strings(init.get("entrypoint")).toArray(String[]::new)))
            .withCommand(script.toArray(String[]::new))
            .withStartupCheckStrategy(new OneShotStartupCheckStrategy().withTimeout(Duration.ofMinutes(2)));

        CADDY = new GenericContainer<>(caddyImage)
            .withNetwork(NET)
            .withCopyToContainer(Transferable.of(":80 {\n" + caddyMediaBlock() + "\n}\n"), "/etc/caddy/Caddyfile")
            .withExposedPorts(80)
            .waitingFor(Wait.forListeningPort());

        POSTGRES.start();
        MINIO.start();
        mc.start();   // one shot: start() returns once the script exited 0
        // Run it again: `docker compose up` does so on every deploy.
        var again = new GenericContainer<>(mc.getDockerImageName())
            .withNetwork(NET)
            .withEnv(mc.getEnvMap())
            .withCreateContainerCmdModifier(c -> c.withEntrypoint(strings(init.get("entrypoint")).toArray(String[]::new)))
            .withCommand(script.toArray(String[]::new))
            .withStartupCheckStrategy(new OneShotStartupCheckStrategy().withTimeout(Duration.ofMinutes(2)));
        again.start();
        CADDY.start();
    }

    @AfterAll
    static void stop() {
        CADDY.stop();
        MINIO.stop();
    }

    static String proxyBase() {
        return "http://" + CADDY.getHost() + ":" + CADDY.getMappedPort(80);
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        // What prod sets, with ceitba.org.ar replaced by the proxy's address.
        r.add("storage.endpoint", MinioPresignedUploadIT::proxyBase);
        r.add("storage.bucket", () -> BUCKET);
        r.add("storage.access-key-id", () -> SERVICE_KEY);
        r.add("storage.secret-access-key", () -> SERVICE_SECRET);
        r.add("storage.public-base-url", () -> proxyBase() + "/" + BUCKET);
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();

    private static RequestPostProcessor as(String email, String... roles) {
        var authorities = Arrays.stream(roles)
            .map(r -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + r)).toList();
        return jwt().jwt(t -> t.claim("email", email).claim("name", email)).authorities(authorities);
    }

    private JsonNode sign(String path, String contentType, int size, RequestPostProcessor who) throws Exception {
        var body = "{\"filename\":\"f\",\"contentType\":\"" + contentType + "\",\"sizeBytes\":" + size + "}";
        var res = mvc.perform(post(path).with(who).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return json.readTree(res);
    }

    // Sends the upload the way the mobile app does: method + every returned
    // header. Content-Length is set by the HTTP client from the body (Java's
    // client refuses it as a user header), so check it matches instead.
    private HttpResponse<String> upload(JsonNode signed, byte[] bytes, Map<String, String> overrides) throws Exception {
        var req = HttpRequest.newBuilder(URI.create(signed.get("uploadUrl").asText()))
            .method(signed.get("method").asText(), HttpRequest.BodyPublishers.ofByteArray(bytes));
        var headers = signed.get("headers");
        assertThat(headers.get("Content-Length").asText()).isEqualTo(String.valueOf(bytes.length));
        headers.fields().forEachRemaining(h -> {
            if (!h.getKey().equalsIgnoreCase("Content-Length")) {
                req.header(h.getKey(), overrides.getOrDefault(h.getKey(), h.getValue().asText()));
            }
        });
        return http.send(req.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<byte[]> get(String url) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private static byte[] randomBytes(int n) {
        var b = new byte[n];
        new Random(n).nextBytes(b);
        return b;
    }

    @Test
    void staffImage_presignedPutThroughProxy_thenAnonymousGet() throws Exception {
        byte[] png = randomBytes(4096);
        var signed = sign("/v1/media/sign-upload", "image/png", png.length, as("boss@itba.edu.ar", "USER", "STAFF"));
        String key = signed.get("key").asText();
        assertThat(signed.get("uploadUrl").asText()).startsWith(proxyBase() + "/" + BUCKET + "/" + key + "?");
        assertThat(signed.get("publicUrl").asText()).isEqualTo(proxyBase() + "/" + BUCKET + "/" + key);

        // Nothing there yet.
        assertThat(get(signed.get("publicUrl").asText()).statusCode()).isIn(403, 404);

        var put = upload(signed, png, Map.of());
        assertThat(put.statusCode()).as(put.body()).isEqualTo(200);

        var got = get(signed.get("publicUrl").asText());
        assertThat(got.statusCode()).isEqualTo(200);
        assertThat(got.body()).isEqualTo(png);
        assertThat(got.headers().firstValue("Content-Type")).contains("image/png");
    }

    @Test
    void proposalAttachment_roundTrip() throws Exception {
        byte[] pdf = randomBytes(10_000);
        var signed = sign("/v1/proposals/attachments/sign-upload", "application/pdf", pdf.length, as("alumno@itba.edu.ar", "USER"));
        assertThat(upload(signed, pdf, Map.of()).statusCode()).isEqualTo(200);
        var got = get(signed.get("publicUrl").asText());
        assertThat(got.statusCode()).isEqualTo(200);
        assertThat(got.body()).isEqualTo(pdf);
    }

    @Test
    void uploadsThatDoNotMatchTheSignatureAreRejected() throws Exception {
        byte[] png = randomBytes(2048);
        var signed = sign("/v1/media/sign-upload", "image/png", png.length, as("boss@itba.edu.ar", "USER", "STAFF"));
        String publicUrl = signed.get("publicUrl").asText();

        // Unsigned PUT to the public URL (anonymous access is download only).
        var unsigned = http.send(HttpRequest.newBuilder(URI.create(publicUrl))
                .PUT(HttpRequest.BodyPublishers.ofByteArray(png)).header("Content-Type", "image/png").build(),
            HttpResponse.BodyHandlers.ofString());
        assertThat(unsigned.statusCode()).isEqualTo(403);

        // A different content type than the one signed.
        assertThat(upload(signed, png, Map.of("Content-Type", "text/html")).statusCode()).isEqualTo(403);

        // A different length than the one signed (Content-Length is signed).
        var req = HttpRequest.newBuilder(URI.create(signed.get("uploadUrl").asText()))
            .PUT(HttpRequest.BodyPublishers.ofByteArray(randomBytes(png.length + 1)))
            .header("Content-Type", "image/png").build();
        assertThat(http.send(req, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);

        assertThat(get(publicUrl).statusCode()).isIn(403, 404);
    }

    @Test
    void anonymousCannotListTheBucket() throws Exception {
        for (var url : List.of(proxyBase() + "/" + BUCKET + "/", proxyBase() + "/" + BUCKET + "/?list-type=2")) {
            var res = get(url);
            assertThat(res.statusCode()).as(url).isEqualTo(403);
            assertThat(new String(res.body(), StandardCharsets.UTF_8)).doesNotContain("ListBucketResult");
        }
        // Bare /ceitba-media is outside the Caddy route (the SPA answers it in
        // prod), so it never reaches MinIO either.
        assertThat(new String(get(proxyBase() + "/" + BUCKET + "?list-type=2").body(), StandardCharsets.UTF_8))
            .doesNotContain("ListBucketResult");
    }

    // The service user can put and get, nothing else: a correctly signed
    // DELETE is refused by its policy.
    @Test
    void serviceUserCannotDelete() throws Exception {
        byte[] png = randomBytes(512);
        var signed = sign("/v1/media/sign-upload", "image/png", png.length, as("boss@itba.edu.ar", "USER", "STAFF"));
        assertThat(upload(signed, png, Map.of()).statusCode()).isEqualTo(200);

        var props = new StorageProperties(proxyBase(), null, BUCKET, SERVICE_KEY, SERVICE_SECRET,
            proxyBase() + "/" + BUCKET, Duration.ofMinutes(5));
        try (var presigner = StorageConfig.presigner(props)) {
            var del = presigner.presignDeleteObject(DeleteObjectPresignRequest.builder()
                .signatureDuration(Duration.ofMinutes(5))
                .deleteObjectRequest(DeleteObjectRequest.builder().bucket(BUCKET).key(signed.get("key").asText()).build())
                .build());
            var res = http.send(HttpRequest.newBuilder(del.url().toURI()).DELETE().build(), HttpResponse.BodyHandlers.ofString());
            assertThat(res.statusCode()).isEqualTo(403);
        }
        assertThat(get(signed.get("publicUrl").asText()).statusCode()).isEqualTo(200);
    }

    // Caddy's request_body limit (12 MB) stops oversized bodies before MinIO,
    // even with a valid signature (the API itself never signs above 10 MB).
    @Test
    void proxyRejectsBodiesOverTheLimit() throws Exception {
        int size = 13 * 1024 * 1024;
        var props = new StorageProperties(proxyBase(), null, BUCKET, SERVICE_KEY, SERVICE_SECRET,
            proxyBase() + "/" + BUCKET, Duration.ofMinutes(5));
        try (var presigner = StorageConfig.presigner(props)) {
            var up = new org.ceitba.api.service.media.S3ObjectStorage(presigner, props, Clock.systemUTC())
                .presignPut("media/too-big.bin", "application/octet-stream", size);
            var req = HttpRequest.newBuilder(URI.create(up.uploadUrl()))
                .PUT(HttpRequest.BodyPublishers.ofByteArray(new byte[size]))
                .header("Content-Type", "application/octet-stream").build();
            assertThat(http.send(req, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(413);
        }
        assertThat(get(proxyBase() + "/" + BUCKET + "/media/too-big.bin").statusCode()).isIn(403, 404);
    }

    // --- repo files -------------------------------------------------------

    @SuppressWarnings("unchecked")
    static Map<String, Object> service(Path composeFile, String name) {
        try (InputStream in = Files.newInputStream(composeFile)) {
            Map<String, Object> doc = new Yaml().load(in);
            var svc = (Map<String, Object>) ((Map<String, Object>) doc.get("services")).get(name);
            assertThat(svc).as(name + " in " + composeFile).isNotNull();
            return svc;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @SuppressWarnings("unchecked")
    static List<String> strings(Object yamlList) {
        return ((List<Object>) yamlList).stream().map(String::valueOf).toList();
    }

    // The `handle /ceitba-media/* { ... }` block of the prod Caddyfile.
    static String caddyMediaBlock() {
        try {
            var caddyfile = Files.readString(Path.of("infrastructure/caddy/Caddyfile"));
            var m = Pattern.compile("(?ms)^(\\s*)handle /ceitba-media/\\* \\{.*?^\\1\\}").matcher(caddyfile);
            assertThat(m.find()).as("handle /ceitba-media/* block in the Caddyfile").isTrue();
            return m.group();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
