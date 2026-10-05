package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.kb.KbLlmEndpoint;
import org.ceitba.api.external.llm.DoChatClient;
import org.ceitba.api.external.llm.LlmApiException;
import org.ceitba.api.external.llm.SyncChatClient;
import org.ceitba.api.repository.kb.KbLlmEndpointRepository;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;

// Resolves custom catalog ids (custom:<endpointName>:<slug>, slash-free so the
// /models/{id} routes work) to their endpoint's client. The id the endpoint
// itself knows (kb_model.remote_model_id) goes in the request body. Each
// endpoint has its own semaphore of max_concurrency (independent of
// KB_SYNC_CONCURRENCY, which only bounds DigitalOcean), an in-memory in-flight
// counter and a short log of failed calls (for /stats).
// The API key is decrypted only here, to build the client; it is never logged.
@Component
public class KbEndpointRegistry {

    public static final String PREFIX = "custom:";
    public static final int ID_MAX = 128;

    // Characters a catalog id may have (it travels in URL paths).
    public static final java.util.regex.Pattern SAFE_ID = java.util.regex.Pattern.compile("[A-Za-z0-9._:-]+");

    public static boolean isCustom(String model) {
        return model != null && model.startsWith(PREFIX) && model.indexOf(':', PREFIX.length()) > PREFIX.length();
    }

    public static String endpointName(String model) {
        return model.substring(PREFIX.length(), model.indexOf(':', PREFIX.length()));
    }

    // "custom:<endpoint>:" (endpoint names never contain ':').
    public static String prefixOf(String endpointName) {
        return PREFIX + endpointName + ":";
    }

    // custom:<endpoint>:<slug>: every char outside [A-Za-z0-9._-] becomes '-',
    // truncated to the id column. withHash appends a short hash of the raw id
    // (for a collision between two raw ids that slug alike).
    public static String catalogId(String endpointName, String rawModel, boolean withHash) {
        var prefix = prefixOf(endpointName);
        var slug = rawModel.replaceAll("[^A-Za-z0-9._-]", "-");
        int room = ID_MAX - prefix.length() - (withHash ? 7 : 0);
        if (slug.length() > room) slug = slug.substring(0, room);
        return prefix + slug + (withHash ? "-" + shortHash(rawModel) : "");
    }

    static String shortHash(String raw) {
        try {
            var d = java.security.MessageDigest.getInstance("SHA-256").digest(raw.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(d, 0, 3);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    // Counters that survive a rebuilt client (endpoint edited).
    private static final class Counters {
        final AtomicInteger inFlight = new AtomicInteger();
        final ArrayDeque<Long> errors = new ArrayDeque<>();   // epoch ms, guarded by itself
    }

    private record Built(java.time.OffsetDateTime version, SyncChatClient client, Semaphore sem) {}

    // One resolved call target.
    public static final class Target {
        private final UUID endpointId;
        private final String rawModel;
        private final SyncChatClient client;
        private final Semaphore sem;
        private final Counters counters;

        Target(UUID endpointId, String rawModel, SyncChatClient client, Semaphore sem, Counters counters) {
            this.endpointId = endpointId;
            this.rawModel = rawModel;
            this.client = client;
            this.sem = sem;
            this.counters = counters;
        }

        public UUID endpointId() { return endpointId; }
        public String rawModel() { return rawModel; }
        public SyncChatClient client() { return client; }
        public Semaphore semaphore() { return sem; }

        // Wraps one HTTP call: in-flight count, failed calls remembered.
        public com.fasterxml.jackson.databind.JsonNode complete(com.fasterxml.jackson.databind.JsonNode body) {
            counters.inFlight.incrementAndGet();
            try {
                return client.complete(body);
            } catch (RuntimeException e) {
                synchronized (counters.errors) {
                    counters.errors.addLast(System.currentTimeMillis());
                    while (counters.errors.size() > 5000) counters.errors.pollFirst();
                }
                throw e;
            } finally {
                counters.inFlight.decrementAndGet();
            }
        }
    }

    private final KbLlmEndpointRepository endpoints;
    private final KbModelRepository models;
    private final KbSecretCipher cipher;
    private final ObjectMapper json;
    private final Map<UUID, Built> built = new ConcurrentHashMap<>();
    private final Map<UUID, Counters> counters = new ConcurrentHashMap<>();

    public KbEndpointRegistry(KbLlmEndpointRepository endpoints, KbModelRepository models, KbSecretCipher cipher,
                              ObjectMapper json) {
        this.endpoints = endpoints;
        this.models = models;
        this.cipher = cipher;
        this.json = json;
    }

    // Throws LlmApiException(0) when the endpoint is gone, disabled or its key unreadable.
    public Target resolve(String model) {
        var name = endpointName(model);
        var e = endpoints.findByName(name)
            .orElseThrow(() -> new LlmApiException(0, "custom endpoint '" + name + "' does not exist"));
        if (!e.isEnabled()) throw new LlmApiException(0, "custom endpoint '" + name + "' is disabled");
        var b = built.compute(e.getId(), (id, old) -> old != null && old.version().equals(e.getUpdatedAt()) ? old : build(e));
        var raw = models.findById(model).map(org.ceitba.api.domain.kb.KbModel::getRemoteModelId)
            .filter(r -> r != null && !r.isBlank())
            .orElseThrow(() -> new LlmApiException(0, "custom model '" + model + "' is not in the catalog (discover the endpoint again)"));
        return new Target(e.getId(), raw, b.client(), b.sem(), counters(e.getId()));
    }

    private Built build(KbLlmEndpoint e) {
        String key;
        try {
            key = cipher.decrypt(e.getApiKeyEncrypted());
        } catch (IllegalStateException ex) {
            throw new LlmApiException(0, "custom endpoint '" + e.getName() + "': " + ex.getMessage());
        }
        return new Built(e.getUpdatedAt(), client(e, key), new Semaphore(Math.max(1, e.getMaxConcurrency())));
    }

    // A fresh client (test button, discovery).
    public SyncChatClient client(KbLlmEndpoint e) {
        String key;
        try {
            key = cipher.decrypt(e.getApiKeyEncrypted());
        } catch (IllegalStateException ex) {
            throw new LlmApiException(0, ex.getMessage());
        }
        return client(e, key);
    }

    private SyncChatClient client(KbLlmEndpoint e, String key) {
        return DoChatClient.openAiCompatible(e.getBaseUrl(), key, json, Duration.ofSeconds(e.getTimeoutSec()));
    }

    private Counters counters(UUID id) {
        return counters.computeIfAbsent(id, k -> new Counters());
    }

    public int inFlight(UUID endpointId) {
        return counters(endpointId).inFlight.get();
    }

    public int errorsSince(UUID endpointId, long sinceEpochMs) {
        var c = counters(endpointId);
        synchronized (c.errors) {
            return (int) c.errors.stream().filter(t -> t >= sinceEpochMs).count();
        }
    }

    // The catalog says this model has no tool calling: use json_object directly.
    public boolean toolsOff(String model) {
        return models.findById(model).map(m -> "no".equals(m.getToolCalling())).orElse(false);
    }
}
