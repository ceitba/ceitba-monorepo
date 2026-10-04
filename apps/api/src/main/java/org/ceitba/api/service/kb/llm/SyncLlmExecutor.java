package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.config.KbLlmProperties;
import org.ceitba.api.external.llm.DoQuotaExhaustedException;
import org.ceitba.api.external.llm.DoQuotaTracker;
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
    private final DoQuotaTracker quota;

    public SyncLlmExecutor(SyncChatClient client, KbLlmProperties props, ObjectMapper json) {
        this(client, props, json, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public SyncLlmExecutor(SyncChatClient client, KbLlmProperties props, ObjectMapper json, DoQuotaTracker quota) {
        this.client = client;
        this.props = props;
        this.json = json;
        this.quota = quota;
    }

    // Rough tokens of a request (prompt at ~4 chars/token plus max_tokens), to
    // compare with the daily tokens DO says are left.
    static long estimateTokens(LlmLine line) {
        return line.params().toString().length() / 4 + line.params().path("max_tokens").asLong(4096);
    }

    // One HTTP call of a request: its own usage and latency. reasoningTokens
    // when the API reports completion_tokens_details.reasoning_tokens.
    public record Attempt(int tokensIn, int tokensOut, int cachedTokens, Integer reasoningTokens, int latencyMs) {}

    // A request's final result plus every HTTP call it took (tool call,
    // json_object fallback, doubled max_tokens retry), in order.
    public record Outcome(LlmOutputParser.LlmResult result, List<Attempt> attempts, int latencyMs) {}

    public void run(List<LlmLine> lines, Consumer<LlmOutputParser.LlmResult> onResult) {
        run(lines, o -> onResult.accept(o.result()), () -> false);
    }

    // True when the pool stopped because DO's daily token quota ran out
    // (a 429 tokens_per_day, or the snapshot left fewer tokens than the next
    // request needs): the requests not started stay unanswered, never failed.

    // stop: checked before each request starts; once true, the remaining
    // requests are abandoned (in-flight ones still report their answers).
    public boolean run(List<LlmLine> lines, Consumer<Outcome> onResult, java.util.function.BooleanSupplier stop) {
        return run(lines.iterator(), onResult, stop);
    }

    // The lines are pulled one at a time, each only once a worker slot is
    // free, so at most KB_SYNC_CONCURRENCY requests are in flight and the
    // source (a paged DB iterator) never needs to hold the whole stage.
    public boolean run(java.util.Iterator<LlmLine> lines, Consumer<Outcome> onResult,
                       java.util.function.BooleanSupplier stop) {
        var quotaPaused = new java.util.concurrent.atomic.AtomicBoolean(false);
        var permits = new Semaphore(props.syncConcurrency());
        var stopped = new java.util.concurrent.atomic.AtomicBoolean(false);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            while (lines.hasNext()) {
                permits.acquireUninterruptibly();
                if (stopped.get() || stop.getAsBoolean()) {
                    stopped.set(true);
                    permits.release();
                    break;
                }
                var line = lines.next();
                pool.submit(() -> {
                    try {
                        if (stopped.get() || stop.getAsBoolean()) {
                            stopped.set(true);
                            return;
                        }
                        if (quota != null && quota.dailyTokensShort(estimateTokens(line))) {
                            quotaPaused.set(true);
                            stopped.set(true);
                            return;
                        }
                        onResult.accept(runTracked(line));
                    } catch (DoQuotaExhaustedException e) {
                        log.warn("KB pipeline: DO daily token quota exhausted; pausing sync requests");
                        quotaPaused.set(true);
                        stopped.set(true);
                    } catch (RuntimeException e) {
                        log.warn("KB pipeline: sync request {} failed: {}", line.customId(), e.getMessage());
                    } finally {
                        permits.release();
                    }
                });
            }
        }
        return quotaPaused.get();
    }

    public static final int MAX_TOKENS_CAP = 32_000;

    public int concurrency() {
        return props.syncConcurrency();
    }

    public LlmOutputParser.LlmResult runOne(LlmLine line) {
        try {
            return runTracked(line).result();
        } catch (DoQuotaExhaustedException e) {
            return new LlmOutputParser.LlmResult(line.customId(), false, null, null, 0, 0, 0, null,
                "HTTP 429: " + e.getMessage());
        }
    }

    // Empty/unparseable tool arguments or a cut at max_tokens: retried once
    // (never more) with double max_tokens (cap 32k), then failed (path gets
    // "+retry").
    public Outcome runTracked(LlmLine line) {
        long started = System.nanoTime();
        var attempts = new java.util.ArrayList<Attempt>();
        var first = attempt(line, attempts);
        LlmOutputParser.LlmResult result = first;
        if (!first.ok() && first.error() != null
                && (first.error().startsWith("TRUNCATED") || first.error().startsWith("EMPTY_TOOL"))) {
            var params = (com.fasterxml.jackson.databind.node.ObjectNode) line.params().deepCopy();
            params.put("max_tokens", Math.min(MAX_TOKENS_CAP, params.path("max_tokens").asInt(4096) * 2));
            var second = attempt(new LlmLine(line.customId(), params), attempts);
            result = new LlmOutputParser.LlmResult(line.customId(), second.ok(), second.toolInput(), second.text(),
                first.tokensIn() + second.tokensIn(), first.tokensOut() + second.tokensOut(),
                first.cachedTokens() + second.cachedTokens(), (second.path() == null ? "none" : second.path()) + "+retry",
                second.ok() ? null : second.error());
        }
        return new Outcome(result, List.copyOf(attempts), (int) ((System.nanoTime() - started) / 1_000_000));
    }

    private com.fasterxml.jackson.databind.JsonNode call(com.fasterxml.jackson.databind.JsonNode body,
                                                         List<Attempt> attempts) {
        long t = System.nanoTime();
        var res = client.complete(body);
        var u = res.path("usage");
        var reasoning = u.path("completion_tokens_details").path("reasoning_tokens");
        attempts.add(new Attempt(u.path("prompt_tokens").asInt(u.path("input_tokens").asInt(0)),
            u.path("completion_tokens").asInt(u.path("output_tokens").asInt(0)),
            u.path("cache_read_input_tokens").asInt(u.path("prompt_tokens_details").path("cached_tokens").asInt(0)),
            reasoning.canConvertToInt() ? reasoning.asInt() : null, (int) ((System.nanoTime() - t) / 1_000_000)));
        return res;
    }

    private LlmOutputParser.LlmResult attempt(LlmLine line, List<Attempt> attempts) {
        try {
            var first = LlmOutputParser.fromChatCompletion(line.customId(),
                call(KbChatPayloads.chatBody(line.params(), false, json), attempts), json);
            if (first.error() != null && (first.error().startsWith("TRUNCATED") || first.error().startsWith("EMPTY_TOOL"))) {
                return first;
            }
            boolean hasTool = line.params().path("tools").size() > 0;
            if (!hasTool || first.toolInput() != null) return first;
            if (first.text() != null && first.text().strip().startsWith("---")) return first;
            LlmOutputParser.LlmResult second;
            try {
                second = LlmOutputParser.fromChatCompletion(line.customId(),
                    call(KbChatPayloads.chatBody(line.params(), true, json), attempts), json);
            } catch (DoQuotaExhaustedException e) {
                throw e;
            } catch (LlmApiException e) {
                // The fallback failed: keep the first answer as when the
                // fallback brings no JSON, with its (paid) tokens.
                log.warn("KB pipeline: json_object fallback of {} failed: HTTP {}", line.customId(), e.status());
                return new LlmOutputParser.LlmResult(line.customId(), first.ok(), null, first.text(), first.tokensIn(),
                    first.tokensOut(), first.cachedTokens(), "text", first.error());
            }
            var usageIn = first.tokensIn() + second.tokensIn();
            var usageOut = first.tokensOut() + second.tokensOut();
            var cached = first.cachedTokens() + second.cachedTokens();
            if (second.toolInput() != null) {
                return new LlmOutputParser.LlmResult(line.customId(), true, second.toolInput(), second.text(), usageIn,
                    usageOut, cached, "json_object", null);
            }
            return new LlmOutputParser.LlmResult(line.customId(), first.ok(), null, first.text(), usageIn, usageOut,
                cached, "text", first.error());
        } catch (DoQuotaExhaustedException e) {
            throw e;   // run() pauses the pool; runOne() reports it
        } catch (LlmApiException e) {
            return new LlmOutputParser.LlmResult(line.customId(), false, null, null, 0, 0, 0, null,
                "HTTP " + e.status() + ": " + e.getMessage());
        }
    }
}
