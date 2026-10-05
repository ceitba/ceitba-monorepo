package org.ceitba.api.service.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;
import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.kb.KbLlmEndpoint;
import org.ceitba.api.domain.kb.KbModel;
import org.ceitba.api.external.llm.LlmApiException;
import org.ceitba.api.repository.kb.KbLlmEndpointRepository;
import org.ceitba.api.repository.kb.KbLlmUsageRepository;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.ceitba.api.repository.kb.KbRunRequestRepository;
import org.ceitba.api.service.kb.llm.KbEndpointRegistry;
import org.ceitba.api.service.kb.llm.KbSecretCipher;
import org.ceitba.api.service.kb.pipeline.KbRunEngine;
import org.ceitba.api.web.kb.admin.KbEndpointDtos;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.net.URI;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

// Staff-managed custom OpenAI-compatible endpoints (own GPU server). The API
// key is encrypted at rest (KbSecretCipher) and never returned or logged.
@Service
public class KbEndpointService {

    private static final Logger log = LoggerFactory.getLogger(KbEndpointService.class);
    private static final Pattern NAME = Pattern.compile("[a-z0-9][a-z0-9-]{0,46}");

    private final KbLlmEndpointRepository endpoints;
    private final KbModelRepository models;
    private final KbRunRequestRepository requests;
    private final KbLlmUsageRepository usage;
    private final KbSettingsService settings;
    private final KbSecretCipher cipher;
    private final KbEndpointRegistry registry;
    private final Clock clock;
    private final org.springframework.transaction.support.TransactionTemplate txTemplate;

    public KbEndpointService(KbLlmEndpointRepository endpoints, KbModelRepository models,
                             KbRunRequestRepository requests, KbLlmUsageRepository usage, KbSettingsService settings,
                             KbSecretCipher cipher, KbEndpointRegistry registry, Clock clock,
                             org.springframework.transaction.support.TransactionTemplate txTemplate) {
        this.txTemplate = txTemplate;
        this.endpoints = endpoints;
        this.models = models;
        this.requests = requests;
        this.usage = usage;
        this.settings = settings;
        this.cipher = cipher;
        this.registry = registry;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<KbEndpointDtos.Item> list() {
        return endpoints.findAllByOrderByNameAsc().stream().map(this::view).toList();
    }

    @Transactional
    public KbEndpointDtos.Item create(UUID userId, JsonNode body) {
        var name = body.path("name").asText("").trim().toLowerCase(java.util.Locale.ROOT);
        if (!NAME.matcher(name).matches()) {
            throw new ValidationException("name", name, "required: lowercase letters, digits and '-' (max 47 chars)");
        }
        if (endpoints.existsByName(name)) throw new ResourceAlreadyExistsException("KbLlmEndpoint", name);
        var e = new KbLlmEndpoint(name, baseUrl(body.path("baseUrl").asText("")), userId, OffsetDateTime.now(clock));
        apply(e, body, false);
        return view(endpoints.save(e));
    }

    @Transactional
    public KbEndpointDtos.Item update(UUID userId, UUID id, JsonNode body) {
        var e = get(id);
        if (body.hasNonNull("name") && !body.get("name").asText().trim().equalsIgnoreCase(e.getName())) {
            throw new ValidationException("name", body.get("name").asText(),
                "cannot be renamed (model ids custom:<name>:<slug> depend on it); create a new endpoint");
        }
        if (body.hasNonNull("baseUrl")) e.setBaseUrl(baseUrl(body.get("baseUrl").asText()));
        apply(e, body, true);
        e.touch(userId, OffsetDateTime.now(clock));
        return view(endpoints.saveAndFlush(e));
    }

    private void apply(KbLlmEndpoint e, JsonNode body, boolean update) {
        if (body.hasNonNull("maxConcurrency")) {
            var v = body.get("maxConcurrency");
            if (!v.canConvertToInt() || v.asInt() < 1 || v.asInt() > 64) {
                throw new ValidationException("maxConcurrency", v, "must be between 1 and 64");
            }
            e.setMaxConcurrency(v.asInt());
        }
        if (body.hasNonNull("timeoutSec")) {
            var v = body.get("timeoutSec");
            if (!v.canConvertToInt() || v.asInt() < 5 || v.asInt() > 3600) {
                throw new ValidationException("timeoutSec", v, "must be between 5 and 3600");
            }
            e.setTimeoutSec(v.asInt());
        }
        if (body.hasNonNull("enabled")) {
            if (!body.get("enabled").isBoolean()) throw new ValidationException("enabled", body.get("enabled"), "must be a boolean");
            e.setEnabled(body.get("enabled").asBoolean());
        }
        // apiKey: absent/null = keep, "" = remove, else replace (encrypted).
        if (body.hasNonNull("apiKey")) {
            if (!body.get("apiKey").isTextual()) throw new ValidationException("apiKey", "(hidden)", "must be a string");
            var key = body.get("apiKey").asText().trim();
            e.setApiKeyEncrypted(key.isEmpty() ? null : cipher.encrypt(key));
        }
    }

    // http(s) only, with a host; no query/fragment; trailing slashes dropped.
    static String baseUrl(String raw) {
        var s = raw == null ? "" : raw.trim();
        boolean ok;
        try {
            var u = new URI(s);
            ok = u.getScheme() != null && (u.getScheme().equalsIgnoreCase("http") || u.getScheme().equalsIgnoreCase("https"))
                && u.getHost() != null && u.getUserInfo() == null && u.getQuery() == null && u.getFragment() == null;
        } catch (java.net.URISyntaxException ex) {
            ok = false;
        }
        if (!ok) throw new ValidationException("baseUrl", s, "must be an http(s) URL with a host (e.g. http://host:8081/v1)");
        s = s.replaceAll("/+$", "");
        if (s.length() > 512) throw new ValidationException("baseUrl", s, "too long");
        return s;
    }

    @Transactional
    public void delete(UUID id) {
        var e = get(id);
        var prefix = KbEndpointRegistry.prefixOf(e.getName());
        var s = settings.effective();
        var used = new ArrayList<String>();
        for (var m : new String[]{s.modelDigest(), s.modelPlan(), s.modelWrite(), s.modelRetry()}) {
            if (m != null && m.startsWith(prefix)) used.add(m);
        }
        if (s.subjectOverrides() != null) {
            s.subjectOverrides().elements().forEachRemaining(o -> {
                for (var f : new String[]{"modelWrite", "modelPlan"}) {
                    if (o.path(f).asText("").startsWith(prefix)) used.add(o.path(f).asText());
                }
            });
        }
        if (!used.isEmpty()) {
            throw new EndpointInUseException("A model of this endpoint is used by the pipeline settings (" + used.get(0) + ")");
        }
        if (requests.countOfActiveRunsWithModelPrefix(prefix, KbRunEngine.ACTIVE) > 0) {
            throw new EndpointInUseException("A model of this endpoint is used by an active run or eval");
        }
        models.deleteAll(models.findAll().stream().filter(m -> m.getId().startsWith(prefix)).toList());
        endpoints.delete(e);
    }

    // 409 KB_ENDPOINT_IN_USE.
    public static class EndpointInUseException extends InvalidStateException {
        public EndpointInUseException(String message) { super(message); }
    }

    // GET {baseUrl}/models with latency. Never throws for an unreachable server.
    public KbEndpointDtos.TestResult test(UUID id) {
        var e = tx(() -> get(id));
        if (e.hasKey() && !cipher.readable(e.getApiKeyEncrypted())) {
            return new KbEndpointDtos.TestResult(false, 0, List.of(),
                "The stored token cannot be decrypted (AUTH_JWT_SECRET or KB_SECRETS_KEY changed): re-enter the token");
        }
        long t = System.nanoTime();
        try {
            var ids = registry.client(e).listModels();
            return new KbEndpointDtos.TestResult(true, (System.nanoTime() - t) / 1_000_000, ids, null);
        } catch (LlmApiException ex) {
            return new KbEndpointDtos.TestResult(false, (System.nanoTime() - t) / 1_000_000, List.of(), ex.getMessage());
        } catch (RuntimeException ex) {
            return new KbEndpointDtos.TestResult(false, (System.nanoTime() - t) / 1_000_000, List.of(),
                ex.getClass().getSimpleName());
        }
    }

    // Lists the endpoint's models and adds custom:<name>:<slug> to the catalog
    // (provider custom, no batch, price 0, disabled); existing ones are untouched.
    public KbEndpointDtos.DiscoverResult discover(UUID id) {
        var e = tx(() -> get(id));
        if (e.hasKey() && !cipher.readable(e.getApiKeyEncrypted())) {
            throw new ValidationException("apiKey", "(hidden)", "the stored token cannot be decrypted: re-enter the token");
        }
        List<String> ids;
        try {
            ids = registry.client(e).listModels();
        } catch (LlmApiException ex) {
            throw new org.ceitba.api.common.exception.ExternalApiException("custom endpoint '" + e.getName() + "'",
                "discover models (" + ex.getMessage() + ")", ex);
        }
        return tx(() -> discoverInto(e, ids));
    }

    private KbEndpointDtos.DiscoverResult discoverInto(KbLlmEndpoint e, List<String> ids) {
        var added = new ArrayList<String>();
        var existing = new ArrayList<String>();
        var now = OffsetDateTime.now(clock);
        for (var raw : ids) {
            if (raw == null || raw.isBlank() || raw.length() > 512) continue;
            // Slash-free id; the same raw id always maps to the same catalog id.
            var catalogId = KbEndpointRegistry.catalogId(e.getName(), raw, false);
            var found = models.findById(catalogId).orElse(null);
            if (found != null && found.getRemoteModelId() != null && !found.getRemoteModelId().equals(raw)) {
                // Another raw id slugs to the same id: tell them apart with a hash.
                catalogId = KbEndpointRegistry.catalogId(e.getName(), raw, true);
                found = models.findById(catalogId).orElse(null);
            }
            if (found != null) {
                if (found.getRemoteModelId() == null) found.setRemoteModelId(raw);
                existing.add(catalogId);
                continue;
            }
            var m = new KbModel(catalogId, raw, "custom", false, false);
            m.setRemoteModelId(raw);
            m.setPrices(BigDecimal.ZERO, BigDecimal.ZERO, null, null, now);
            m.setPriceSource("custom");
            models.save(m);
            added.add(catalogId);
        }
        log.info("KB endpoint {}: discovered {} new model(s), {} known", e.getName(), added.size(), existing.size());
        return new KbEndpointDtos.DiscoverResult(added, existing);
    }

    @Transactional(readOnly = true)
    public KbEndpointDtos.Stats stats(UUID id, int minutes) {
        if (minutes < 1 || minutes > 10080) throw new ValidationException("minutes", minutes, "must be between 1 and 10080");
        var e = get(id);
        var now = OffsetDateTime.now(clock);
        var row = usage.endpointStats(KbEndpointRegistry.prefixOf(e.getName()), now.minusMinutes(minutes)).get(0);
        long calls = ((Number) row[0]).longValue();
        long empty = ((Number) row[1]).longValue();
        Long p50 = row[2] == null ? null : Math.round(((Number) row[2]).doubleValue());
        Long p95 = row[3] == null ? null : Math.round(((Number) row[3]).doubleValue());
        double outTokens = ((Number) row[4]).doubleValue();
        double latencySec = ((Number) row[5]).doubleValue() / 1000.0;
        // Failed calls leave no usage row: they come from the in-memory log (since the last restart).
        int failed = registry.errorsSince(id, now.minusMinutes(minutes).toInstant().toEpochMilli());
        double tps = latencySec > 0 ? Math.round(outTokens / latencySec * 10) / 10.0 : 0;
        return new KbEndpointDtos.Stats(minutes, calls + failed, empty + failed, p50, p95, tps, registry.inFlight(id));
    }

    private KbLlmEndpoint get(UUID id) {
        return endpoints.findById(id).orElseThrow(() -> new ResourceNotFoundException("KbLlmEndpoint", id.toString()));
    }

    private KbEndpointDtos.Item view(KbLlmEndpoint e) {
        long count = models.countByIdStartingWith(KbEndpointRegistry.prefixOf(e.getName()));
        return new KbEndpointDtos.Item(e.getId(), e.getName(), e.getBaseUrl(), e.hasKey(),
            cipher.readable(e.getApiKeyEncrypted()), e.getMaxConcurrency(), e.getTimeoutSec(), e.isEnabled(), count,
            e.getCreatedAt(), e.getUpdatedAt());
    }

    private <T> T tx(java.util.function.Supplier<T> s) {
        return txTemplate.execute(st -> s.get());
    }
}
