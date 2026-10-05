package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.ceitba.api.config.KbLlmProperties;
import org.ceitba.api.domain.kb.KbLlmEndpoint;
import org.ceitba.api.domain.kb.KbModel;
import org.ceitba.api.external.llm.FakeSyncChatClient;
import org.ceitba.api.repository.kb.KbLlmEndpointRepository;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.ceitba.api.service.kb.InMemoryRepo;
import org.ceitba.api.service.kb.NoTx;
import org.ceitba.api.service.kb.admin.KbEndpointService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

// A fake OpenAI-compatible server (llama.cpp-like) stands in for the user's GPU.
class KbCustomEndpointTest {

    final ObjectMapper json = new ObjectMapper();
    final KbSecretCipher cipher = new KbSecretCipher("", "test-jwt-secret");
    HttpServer server;
    final AtomicInteger inFlight = new AtomicInteger();
    final AtomicInteger peak = new AtomicInteger();
    final List<String> bodies = Collections.synchronizedList(new ArrayList<>());
    final List<String> auth = Collections.synchronizedList(new ArrayList<>());
    InMemoryRepo<KbLlmEndpoint, UUID> endpointRows;
    InMemoryRepo<KbModel, String> modelRows;
    KbEndpointRegistry registry;

    @BeforeEach
    void setUp() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        server.createContext("/v1/chat/completions", ex -> {
            bodies.add(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            auth.add(ex.getRequestHeaders().getFirst("Authorization"));
            peak.accumulateAndGet(inFlight.incrementAndGet(), Math::max);
            try {
                Thread.sleep(200);
            } catch (InterruptedException ignored) {
            }
            inFlight.decrementAndGet();
            var res = """
                {"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"{\\"ok\\":true}"}}],
                 "usage":{"prompt_tokens":10,"completion_tokens":5}}""".getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, res.length);
            ex.getResponseBody().write(res);
            ex.close();
        });
        server.createContext("/v1/models", ex -> {
            var res = "{\"data\":[{\"id\":\"qwen3.gguf\"},{\"id\":\"org/llama\"}]}".getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, res.length);
            ex.getResponseBody().write(res);
            ex.close();
        });
        server.start();

        endpointRows = new InMemoryRepo<>(KbLlmEndpoint::getId);
        var repo = endpointRows.on("findByName", a -> endpointRows.all().stream()
            .filter(e -> e.getName().equals(a[0])).findFirst()).as(KbLlmEndpointRepository.class);
        modelRows = new InMemoryRepo<>(KbModel::getId);
        var endpoint = new KbLlmEndpoint("gpu", "http://127.0.0.1:" + server.getAddress().getPort() + "/v1", null,
            OffsetDateTime.now());
        endpoint.setMaxConcurrency(2);
        endpoint.setApiKeyEncrypted(cipher.encrypt("secret-token"));
        endpointRows.rows.put(endpoint.getId(), endpoint);
        registry = new KbEndpointRegistry(repo, modelRows.as(KbModelRepository.class), cipher, json);
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    void customModelGoesToItsEndpointWithItsOwnConcurrency() throws Exception {
        // KB_SYNC_CONCURRENCY is 16, the endpoint allows 2: only 2 are ever in flight.
        var catalog = new KbModel("custom:gpu:my-model.gguf", "my/model.gguf", "custom", false, true);
        catalog.setRemoteModelId("my/model.gguf");
        modelRows.rows.put(catalog.getId(), catalog);
        var exec = new SyncLlmExecutor(new FakeSyncChatClient(json), new KbLlmProperties(null, "k", "sync", 16, false),
            json, null, registry);
        var lines = new ArrayList<LlmLine>();
        for (int i = 0; i < 6; i++) {
            lines.add(new LlmLine("c" + i, json.readTree("""
                {"model":"custom:gpu:my-model.gguf","max_tokens":100,"system":"s",
                 "tools":[{"name":"submit_page","input_schema":{"type":"object"}}],
                 "messages":[{"role":"user","content":"x"}]}""")));
        }
        var ok = new AtomicInteger();
        exec.run(lines, (SyncLlmExecutor.Outcome o) -> {
            if (o.result().ok()) ok.incrementAndGet();
        }, () -> false);
        assertThat(ok.get()).isEqualTo(6);
        assertThat(peak.get()).isEqualTo(2);
        assertThat(bodies).hasSize(6).allSatisfy(b -> assertThat(b).contains("\"model\":\"my/model.gguf\"")
            .doesNotContain("reasoning_effort"));
        assertThat(auth).allSatisfy(a -> assertThat(a).isEqualTo("Bearer secret-token"));
        assertThat(registry.inFlight(endpointRows.all().get(0).getId())).isZero();
    }

    @Test
    void discoverUpsertsCatalogIdsAndKeepsExistingOnes() {
        var existing = new KbModel("custom:gpu:qwen3.gguf", "mine", "custom", false, true);
        existing.setRemoteModelId("qwen3.gguf");
        modelRows.rows.put(existing.getId(), existing);
        var service = new KbEndpointService(endpointRows.on("findByName", a -> java.util.Optional.empty())
            .as(KbLlmEndpointRepository.class), modelRows.as(KbModelRepository.class), null, null, null, cipher,
            registry, Clock.systemUTC(), NoTx.template());
        var res = service.discover(endpointRows.all().get(0).getId());
        assertThat(res.added()).containsExactly("custom:gpu:org-llama");
        assertThat(res.existing()).containsExactly("custom:gpu:qwen3.gguf");
        var added = modelRows.rows.get("custom:gpu:org-llama");
        assertThat(added.getProvider()).isEqualTo("custom");
        assertThat(added.isBatchSupported()).isFalse();
        assertThat(added.isEnabled()).isFalse();
        assertThat(added.getInputPerM()).isEqualByComparingTo("0");
        assertThat(modelRows.rows.get("custom:gpu:qwen3.gguf").isEnabled()).isTrue();   // untouched
    }

    @Test
    void rawIdWithSlashGetsSlashFreeCatalogIdAndRoutesWithRawId() throws Exception {
        var service = new KbEndpointService(endpointRows.on("findByName", a -> java.util.Optional.empty())
            .as(KbLlmEndpointRepository.class), modelRows.as(KbModelRepository.class), null, null, null, cipher,
            registry, Clock.systemUTC(), NoTx.template());
        service.discover(endpointRows.all().get(0).getId());
        var m = modelRows.rows.get("custom:gpu:org-llama");
        assertThat(m.getRemoteModelId()).isEqualTo("org/llama");
        assertThat(modelRows.rows.keySet()).allSatisfy(id -> assertThat(id).doesNotContain("/"));
        // Same slug, different raw id: told apart by a hash; discovering again changes nothing.
        assertThat(KbEndpointRegistry.catalogId("gpu", "org llama", false)).isEqualTo("custom:gpu:org-llama");
        assertThat(KbEndpointRegistry.catalogId("gpu", "org llama", true)).startsWith("custom:gpu:org-llama-")
            .hasSize("custom:gpu:org-llama-".length() + 6);
        assertThat(KbEndpointRegistry.catalogId("gpu", "x".repeat(300), true)).hasSize(128);
        assertThat(service.discover(endpointRows.all().get(0).getId()).added()).isEmpty();

        // The service's stub hid findByName from the shared repo: restore it for the registry.
        endpointRows.on("findByName", a -> endpointRows.all().stream().filter(e -> e.getName().equals(a[0])).findFirst());
        var exec = new SyncLlmExecutor(new FakeSyncChatClient(json), new KbLlmProperties(null, "k", "sync", 16, false),
            json, null, registry);
        var line = new LlmLine("c", json.readTree("""
            {"model":"custom:gpu:org-llama","max_tokens":100,"system":"s","messages":[{"role":"user","content":"x"}]}"""));
        exec.run(List.of(line), (SyncLlmExecutor.Outcome o) -> { }, () -> false);
        assertThat(bodies).hasSize(1).allSatisfy(b -> assertThat(b).contains("\"model\":\"org/llama\""));
    }

    @Test
    void doKeyIsNeededOnlyWhenSomeStageModelIsNotCustom() {
        var router = new KbLlmRouter(new org.ceitba.api.external.llm.UnconfiguredLlmBatchClient(),
            new org.ceitba.api.external.llm.UnconfiguredSyncChatClient(), null, null);
        assertThat(router.availableFor(List.of("custom:gpu:a", "custom:gpu:b"))).isTrue();
        assertThat(router.availableFor(List.of("custom:gpu:a", "glm-5"))).isFalse();
    }
}
