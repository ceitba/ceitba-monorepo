package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.config.KbLlmProperties;
import org.ceitba.api.external.llm.SyncChatClient;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

// Each HTTP call is an attempt (own usage, latency, reasoning tokens);
// max_tokens is doubled at most once; a stop condition abandons queued requests.
class SyncLlmExecutorAttemptsTest {

    final ObjectMapper json = new ObjectMapper();

    JsonNode params(int maxTokens) throws Exception {
        return json.readTree("""
            {"model":"glm-5.3-flash","max_tokens":%d,"system":"s",
             "tools":[{"name":"submit_digest","input_schema":{"type":"object"}}],
             "messages":[{"role":"user","content":"x"}]}""".formatted(maxTokens));
    }

    // Answers with finish_reason=length `cuts` times, then a valid tool call.
    SyncChatClient client(int cuts, List<Integer> maxTokensSeen) {
        var calls = new AtomicInteger();
        return new SyncChatClient() {
            public boolean available() { return true; }
            public List<String> listModels() { return List.of(); }
            public JsonNode complete(JsonNode body) {
                maxTokensSeen.add(body.path("max_tokens").asInt());
                boolean cut = calls.incrementAndGet() <= cuts;
                var out = json.createObjectNode();
                var choice = out.putArray("choices").addObject();
                choice.put("finish_reason", cut ? "length" : "tool_calls");
                var msg = choice.putObject("message");
                if (!cut) {
                    msg.putArray("tool_calls").addObject().putObject("function").put("name", "submit_digest")
                        .put("arguments", "{\"topics\":[{\"name\":\"a\",\"summary\":\"b\"}]}");
                }
                var u = out.putObject("usage");
                u.put("prompt_tokens", 100);
                u.put("completion_tokens", cut ? 4000 : 500);
                u.putObject("completion_tokens_details").put("reasoning_tokens", cut ? 3900 : 200);
                return out;
            }
        };
    }

    @Test
    void truncatedAnswerIsRetriedOnceWithDoubleMaxTokensAndEachAttemptTracked() throws Exception {
        var seen = Collections.synchronizedList(new ArrayList<Integer>());
        var exec = new SyncLlmExecutor(client(1, seen), new KbLlmProperties(null, "k", "sync", 4, false), json);
        var o = exec.runTracked(new LlmLine("c1", params(4000)));
        assertThat(o.result().ok()).isTrue();
        assertThat(o.result().path()).isEqualTo("tool+retry");
        assertThat(seen).containsExactly(4000, 8000);
        assertThat(o.attempts()).hasSize(2);
        assertThat(o.attempts().get(0).tokensOut()).isEqualTo(4000);
        assertThat(o.attempts().get(0).reasoningTokens()).isEqualTo(3900);
        assertThat(o.attempts().get(1).tokensOut()).isEqualTo(500);
        assertThat(o.latencyMs()).isGreaterThanOrEqualTo(0);
    }

    @Test
    void neverDoublesTwice() throws Exception {
        var seen = Collections.synchronizedList(new ArrayList<Integer>());
        var exec = new SyncLlmExecutor(client(5, seen), new KbLlmProperties(null, "k", "sync", 4, false), json);
        var o = exec.runTracked(new LlmLine("c1", params(4000)));
        assertThat(o.result().ok()).isFalse();
        assertThat(o.result().error()).startsWith("TRUNCATED");
        assertThat(seen).containsExactly(4000, 8000);
    }

    @Test
    void stopAbandonsQueuedRequests() throws Exception {
        var seen = Collections.synchronizedList(new ArrayList<Integer>());
        var exec = new SyncLlmExecutor(client(0, seen), new KbLlmProperties(null, "k", "sync", 1, false), json);
        var lines = new ArrayList<LlmLine>();
        for (int i = 0; i < 6; i++) lines.add(new LlmLine("c" + i, params(4000)));
        var done = new AtomicInteger();
        exec.run(lines, (SyncLlmExecutor.Outcome o) -> done.incrementAndGet(), () -> done.get() >= 2);
        assertThat(done.get()).isEqualTo(2);
        assertThat(seen).hasSize(2);
    }
}
