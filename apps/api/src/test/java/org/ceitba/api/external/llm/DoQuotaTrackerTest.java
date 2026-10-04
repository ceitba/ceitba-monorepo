package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.config.KbLlmProperties;
import org.ceitba.api.service.kb.llm.BatchLlmExecutor;
import org.ceitba.api.service.kb.llm.LlmLine;
import org.ceitba.api.service.kb.llm.SyncLlmExecutor;
import org.junit.jupiter.api.Test;

import java.net.http.HttpHeaders;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DoQuotaTrackerTest {

    final ObjectMapper json = new ObjectMapper();
    final Clock clock = Clock.fixed(Instant.parse("2026-10-04T12:00:00Z"), ZoneOffset.UTC);

    DoQuotaTracker tracker() {
        var t = new DoQuotaTracker(clock);
        t.observe(HttpHeaders.of(Map.of(
            "x-ratelimit-limit-batch-creations-per-hour", List.of("5"),
            "x-ratelimit-remaining-batch-creations-per-hour", List.of("0"),
            "x-ratelimit-limit-tokens-per-day", List.of("45000000"),
            "x-ratelimit-remaining-tokens-per-day", List.of("1000"),
            "x-ratelimit-reset-tokens-per-day", List.of("0"),
            "Retry-After", List.of("30")), (a, b) -> true));
        return t;
    }

    @Test
    void parsesLimitAndRemainingPairsByHeaderSuffix() {
        var t = tracker();
        var c = t.counter("batch-creations-per-hour").orElseThrow();
        assertThat(c.limit()).isEqualTo(5);
        assertThat(c.remaining()).isZero();
        assertThat(t.counter("tokens-per-day").orElseThrow().remaining()).isEqualTo(1000);
        assertThat(t.counter("tokens-per-day").orElseThrow().observedAt()).isNotNull();
        assertThat(t.lastRetryAfterSeconds()).contains(30L);
        assertThat(t.counter("tokens-per-minute")).isEmpty();
    }

    @Test
    void batchCreationIsSkippedWithoutCallingDoWhenNoneIsLeft() {
        var neverCalled = (LlmBatchClient) java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),
            new Class<?>[] {LlmBatchClient.class}, (p, m, a) -> { throw new AssertionError("DO called: " + m.getName()); });
        var exec = new BatchLlmExecutor(neverCalled, json, tracker(), clock);
        var lines = List.of(new LlmLine("c1", json.createObjectNode()));
        assertThatThrownBy(() -> exec.submit("n", "openai-gpt-5", "gpt-5", lines, "rid"))
            .isInstanceOfSatisfying(DoBatchSlotException.class, e -> {
                assertThat(e.retryAt().toInstant()).isEqualTo(clock.instant().plus(Duration.ofMinutes(10)));
                assertThat(e.getMessage()).contains("0/5 esta hora");
            });
    }

    @Test
    void dailyTokenQuotaPausesTheSyncPoolInsteadOfFailingRequests() throws Exception {
        var client = new SyncChatClient() {
            public boolean available() { return true; }
            public com.fasterxml.jackson.databind.JsonNode complete(com.fasterxml.jackson.databind.JsonNode body) {
                throw new DoQuotaExhaustedException("429 tokens_per_day");
            }
            public List<String> listModels() { return List.of(); }
        };
        var exec = new SyncLlmExecutor(client, new KbLlmProperties(null, "k", "sync", 2, false), json,
            new DoQuotaTracker(clock));
        var line = new LlmLine("c1", json.readTree("{\"model\":\"m\",\"max_tokens\":100,\"messages\":[]}"));
        var answers = new java.util.concurrent.atomic.AtomicInteger();
        assertThat(exec.run(List.of(line), o -> answers.incrementAndGet(), () -> false)).isTrue();
        assertThat(answers).hasValue(0);
        // a snapshot with fewer daily tokens than the request needs pauses before calling DO
        var quiet = new FakeSyncChatClient(json);
        var exec2 = new SyncLlmExecutor(quiet, new KbLlmProperties(null, "k", "sync", 2, false), json, tracker());
        var big = new LlmLine("c2", json.readTree("{\"model\":\"m\",\"max_tokens\":5000,\"messages\":[]}"));
        assertThat(exec2.run(List.of(big), o -> answers.incrementAndGet(), () -> false)).isTrue();
        assertThat(answers).hasValue(0);
    }
}
