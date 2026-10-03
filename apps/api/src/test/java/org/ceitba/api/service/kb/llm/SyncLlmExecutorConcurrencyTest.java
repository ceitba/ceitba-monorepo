package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.config.KbLlmProperties;
import org.ceitba.api.external.llm.FakeSyncChatClient;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

// KB_SYNC_CONCURRENCY requests really are in flight at once.
class SyncLlmExecutorConcurrencyTest {

    final ObjectMapper json = new ObjectMapper();

    @Test
    void fansOutUpToTheConfiguredConcurrency() throws Exception {
        var client = new FakeSyncChatClient(json);
        var inFlight = new AtomicInteger();
        var peak = new AtomicInteger();
        client.respond(r -> {
            int n = inFlight.incrementAndGet();
            peak.accumulateAndGet(n, Math::max);
            try {
                Thread.sleep(300);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            inFlight.decrementAndGet();
            return json.createObjectNode().put("markdown", "ok");
        });
        var exec = new SyncLlmExecutor(client, new KbLlmProperties(null, "k", "sync", 4, true), json);
        var lines = new ArrayList<LlmLine>();
        for (int i = 0; i < 8; i++) {
            lines.add(new LlmLine("c" + i, json.readTree("""
                {"model":"glm-5.3","max_tokens":100,"system":"s",
                 "tools":[{"name":"submit_page","input_schema":{"type":"object"}}],
                 "messages":[{"role":"user","content":"x"}]}""")));
        }
        List<Integer> latencies = Collections.synchronizedList(new ArrayList<>());
        long t0 = System.nanoTime();
        exec.run(lines, (SyncLlmExecutor.Outcome o) -> latencies.add(o.latencyMs()), () -> false);
        long wallMs = (System.nanoTime() - t0) / 1_000_000;
        assertThat(peak.get()).isEqualTo(4);
        assertThat(latencies).hasSize(8).allSatisfy(ms -> assertThat(ms).isGreaterThanOrEqualTo(290));
        assertThat(wallMs).isLessThan(1500);   // 2 waves of 300 ms, not 8 x 300
    }
}
