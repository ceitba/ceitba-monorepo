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

// Resolves custom model ids (custom/<endpointName>/<rawModelId>) to their
// endpoint's client. Each endpoint has its own semaphore of max_concurrency
// (independent of KB_SYNC_CONCURRENCY, which only bounds DigitalOcean), an
// in-memory in-flight counter and a short log of failed calls (for /stats).
// The API key is decrypted only here, to build the client; it is never logged.
@Component
public class KbEndpointRegistry {

    public static final String PREFIX = "custom/";

    public static boolean isCustom(String model) {
        return model != null && model.startsWith(PREFIX) && model.indexOf('/', PREFIX.length()) > PREFIX.length();
    }

    public static String endpointName(String model) {
        return model.substring(PREFIX.length(), model.indexOf('/', PREFIX.length()));
    }

    // The id the endpoint itself knows (sent in the request body).
    public static String rawModel(String model) {
        return model.substring(model.indexOf('/', PREFIX.length()) + 1);
    }

    public static String catalogId(String endpointName, String rawModel) {
        return PREFIX + endpointName + "/" + rawModel;
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
        return new Target(e.getId(), rawModel(model), b.client(), b.sem(), counters(e.getId()));
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
