package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.config.KbLlmProperties;
import org.ceitba.api.external.llm.LlmApiException;
import org.ceitba.api.external.llm.LlmOutputParser;
import org.ceitba.api.external.llm.SyncChatClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.function.Consumer;

// SYNC mode: OpenAI-compatible chat completions, KB_SYNC_CONCURRENCY at a
// time; each result is handed to `onResult` as soon as it arrives (the
// engine persists it, so a restart never redoes it). Structured output via
// tools + tool_choice; when no tool call comes back, a JSON object in the
// content is accepted (path content-json); otherwise, unless the answer is
// a page file (starts with ---), it is asked again with response_format
// json_object and the schema in the prompt (path json_object).
@Component
public class SyncLlmExecutor {

    private static final Logger log = LoggerFactory.getLogger(SyncLlmExecutor.class);

    private final SyncChatClient client;
    private final KbLlmProperties props;
    private final ObjectMapper json;

    public SyncLlmExecutor(SyncChatClient client, KbLlmProperties props, ObjectMapper json) {
        this.client = client;
        this.props = props;
        this.json = json;
    }

    public void run(List<LlmLine> lines, Consumer<LlmOutputParser.LlmResult> onResult) {
        var permits = new Semaphore(props.syncConcurrency());
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (var line : lines) {
                pool.submit(() -> {
                    permits.acquireUninterruptibly();
                    try {
                        onResult.accept(runOne(line));
                    } catch (RuntimeException e) {
                        log.warn("KB pipeline: sync request {} failed: {}", line.customId(), e.getMessage());
                    } finally {
                        permits.release();
                    }
                });
            }
        }
    }

    public static final int MAX_TOKENS_CAP = 32_000;

    // Empty/unparseable tool arguments or a cut at max_tokens: retried once
    // with double max_tokens (cap 32k), then failed (path gets "+retry").
    public LlmOutputParser.LlmResult runOne(LlmLine line) {
        var first = attempt(line);
        if (first.ok() || first.error() == null
                || !(first.error().startsWith("TRUNCATED") || first.error().startsWith("EMPTY_TOOL"))) {
            return first;
        }
        var params = (com.fasterxml.jackson.databind.node.ObjectNode) line.params().deepCopy();
        params.put("max_tokens", Math.min(MAX_TOKENS_CAP, params.path("max_tokens").asInt(4096) * 2));
        var second = attempt(new LlmLine(line.customId(), params));
        return new LlmOutputParser.LlmResult(line.customId(), second.ok(), second.toolInput(), second.text(),
            first.tokensIn() + second.tokensIn(), first.tokensOut() + second.tokensOut(),
            first.cachedTokens() + second.cachedTokens(), (second.path() == null ? "none" : second.path()) + "+retry",
            second.ok() ? null : second.error());
    }

    private LlmOutputParser.LlmResult attempt(LlmLine line) {
        try {
            var first = LlmOutputParser.fromChatCompletion(line.customId(),
                client.complete(KbChatPayloads.chatBody(line.params(), false, json)), json);
            if (first.error() != null && (first.error().startsWith("TRUNCATED") || first.error().startsWith("EMPTY_TOOL"))) {
                return first;
            }
            boolean hasTool = line.params().path("tools").size() > 0;
            if (!hasTool || first.toolInput() != null) return first;
            if (first.text() != null && first.text().strip().startsWith("---")) return first;
            var second = LlmOutputParser.fromChatCompletion(line.customId(),
                client.complete(KbChatPayloads.chatBody(line.params(), true, json)), json);
            var usageIn = first.tokensIn() + second.tokensIn();
            var usageOut = first.tokensOut() + second.tokensOut();
            var cached = first.cachedTokens() + second.cachedTokens();
            if (second.toolInput() != null) {
                return new LlmOutputParser.LlmResult(line.customId(), true, second.toolInput(), second.text(), usageIn,
                    usageOut, cached, "json_object", null);
            }
            return new LlmOutputParser.LlmResult(line.customId(), first.ok(), null, first.text(), usageIn, usageOut,
                cached, "text", first.error());
        } catch (LlmApiException e) {
            return new LlmOutputParser.LlmResult(line.customId(), false, null, null, 0, 0, 0, null,
                "HTTP " + e.status() + ": " + e.getMessage());
        }
    }
}
