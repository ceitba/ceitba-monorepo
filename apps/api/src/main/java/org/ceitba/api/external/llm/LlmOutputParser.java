package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

// Parses batch output/error JSONL defensively, by custom_id. The exact
// Anthropic output shape on DO is not documented, so each line may be:
//   {custom_id, result: {type: succeeded|errored, message: <Messages response>, error}}   (Anthropic batches)
//   {custom_id, response: {status_code, body: <Messages | chat.completion>}, error}       (OpenAI batches)
//   {custom_id, ...<Messages | chat.completion> fields at the top level}
// and the message an Anthropic Messages response (content[] with tool_use /
// text, usage.input_tokens/output_tokens) or an OpenAI chat completion
// (choices[0].message.tool_calls[0].function.arguments | content,
// usage.prompt_tokens/completion_tokens).
public final class LlmOutputParser {

    private LlmOutputParser() {}

    // ok: there is a usable answer. toolInput: the first tool call's input
    // (JSON) when present, else a JSON object found in the text; text:
    // concatenated text content. cachedTokens: cached input tokens
    // (usage.cache_read_input_tokens | prompt_tokens_details.cached_tokens).
    // path: tool | content-json | text (how the answer came back).
    public record LlmResult(String customId, boolean ok, JsonNode toolInput, String text, int tokensIn,
                            int tokensOut, int cachedTokens, String path, String error) {}

    public static Map<String, LlmResult> parse(byte[] jsonl, ObjectMapper json) {
        Map<String, LlmResult> out = new LinkedHashMap<>();
        if (jsonl == null) return out;
        for (var line : new String(jsonl, StandardCharsets.UTF_8).split("\n")) {
            if (line.isBlank()) continue;
            JsonNode node;
            try {
                node = json.readTree(line);
            } catch (Exception e) {
                continue;
            }
            var r = parseLine(node, json);
            if (r != null) out.put(r.customId(), r);
        }
        return out;
    }

    // Streams a JSONL file: each parsed result goes to `sink` as its line is
    // read, so a big output never sits in memory. Unparseable lines are skipped.
    public static void parse(java.nio.file.Path jsonl, ObjectMapper json,
                             java.util.function.Consumer<LlmResult> sink) {
        if (jsonl == null) return;
        try (var in = java.nio.file.Files.newBufferedReader(jsonl, StandardCharsets.UTF_8)) {
            String line;
            while ((line = in.readLine()) != null) {
                if (line.isBlank()) continue;
                JsonNode node;
                try {
                    node = json.readTree(line);
                } catch (Exception e) {
                    continue;
                }
                var r = parseLine(node, json);
                if (r != null) sink.accept(r);
            }
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    static LlmResult parseLine(JsonNode line, ObjectMapper json) {
        var id = textOf(line, "custom_id");
        if (id == null) id = textOf(line.path("request"), "custom_id");
        if (id == null) return null;

        String error = null;
        JsonNode message = null;
        var result = line.path("result");
        if (result.isObject()) {
            var type = textOf(result, "type");
            if (type != null && !type.equals("succeeded")) error = describe(result.path("error"), type);
            message = result.has("message") ? result.path("message") : null;
        }
        var response = line.path("response");
        if (message == null && response.isObject()) {
            int status = response.path("status_code").asInt(200);
            if (status / 100 != 2) error = "HTTP " + status + " " + describe(response.path("body").path("error"), "");
            message = response.has("body") ? response.path("body") : response;
        }
        if (line.path("error").isObject() || line.path("error").isTextual()) {
            error = describe(line.path("error"), "error");
        }
        if (message == null && (line.has("content") || line.has("choices"))) message = line;
        if (message == null || message.isMissingNode() || message.isNull()) {
            return new LlmResult(id, false, null, null, 0, 0, 0, null, error == null ? "no response" : error);
        }

        JsonNode toolInput = null;
        boolean calledTool = false;
        var text = new StringBuilder();
        var content = message.path("content");
        if (content.isArray()) {
            for (var block : content) {
                var type = textOf(block, "type");
                if ("tool_use".equals(type) && !calledTool) {
                    calledTool = true;
                    toolInput = block.path("input");
                }
                if ("text".equals(type) && block.hasNonNull("text")) text.append(block.path("text").asText());
            }
        } else if (content.isTextual()) {
            text.append(content.asText());
        }
        var choice = message.path("choices").path(0).path("message");
        if (choice.isObject()) {
            // reasoning_content (reasoning models) is never kept.
            var call = choice.path("tool_calls").path(0).path("function").path("arguments");
            if (!calledTool && choice.path("tool_calls").size() > 0) {
                calledTool = true;
                if (call.isTextual() && !call.asText().isBlank()) {
                    try {
                        toolInput = json.readTree(call.asText());
                    } catch (Exception ignored) {
                        toolInput = null;   // unparseable arguments
                    }
                } else if (call.isObject()) {
                    toolInput = call;
                }
            }
            if (choice.path("content").isTextual()) text.append(choice.path("content").asText());
        }
        // Cut by max_tokens (reasoning models spend small budgets thinking) or
        // a tool call with empty/unparseable arguments: a failed request.
        var finish = message.path("choices").path(0).path("finish_reason").asText(
            message.path("stop_reason").asText(""));
        boolean truncated = finish.equals("length") || finish.equals("max_tokens");
        boolean emptyTool = calledTool && (toolInput == null || !toolInput.isObject() || toolInput.isEmpty());
        if (emptyTool) toolInput = null;
        String path = toolInput != null ? "tool" : null;
        if (toolInput == null && !calledTool && !text.isEmpty()) {
            var obj = jsonObjectIn(text.toString(), json);
            if (obj != null) {
                toolInput = obj;
                path = "content-json";
            } else {
                path = "text";
            }
        }
        if (error == null && truncated) error = "TRUNCATED: stopped at max_tokens (" + finish + ")";
        else if (error == null && emptyTool) error = "EMPTY_TOOL: empty or unparseable tool arguments";
        var usage = message.path("usage");
        int in = usage.path("input_tokens").asInt(usage.path("prompt_tokens").asInt(0));
        int out = usage.path("output_tokens").asInt(usage.path("completion_tokens").asInt(0));
        int cached = usage.path("cache_read_input_tokens").asInt(
            usage.path("prompt_tokens_details").path("cached_tokens").asInt(0));
        boolean ok = error == null && (toolInput != null || (!calledTool && !text.isEmpty()));
        return new LlmResult(id, ok, withoutNul(toolInput), text.isEmpty() ? null : withoutNul(text.toString()),
            in, out, cached, path, ok ? null : (error == null ? "empty response" : error));
    }

    // Postgres text/jsonb can't hold U+0000 ("unsupported Unicode escape
    // sequence"), and models occasionally emit it (gpt-5-nano wrote
    // a NUL inside "distribución"): one such answer failed a whole eval. Dropped.
    static String withoutNul(String s) {
        return s == null || s.indexOf('\u0000') < 0 ? s : s.replace("\u0000", "");
    }

    static JsonNode withoutNul(JsonNode node) {
        if (node == null) return null;
        if (node.isTextual()) {
            var t = node.asText();
            return t.indexOf('\u0000') < 0 ? node : com.fasterxml.jackson.databind.node.TextNode.valueOf(withoutNul(t));
        }
        if (node instanceof com.fasterxml.jackson.databind.node.ObjectNode o) {
            var out = o.objectNode();
            o.fields().forEachRemaining(e -> out.set(withoutNul(e.getKey()), withoutNul(e.getValue())));
            return out;
        }
        if (node instanceof com.fasterxml.jackson.databind.node.ArrayNode a) {
            var out = a.arrayNode();
            a.forEach(v -> out.add(withoutNul(v)));
            return out;
        }
        return node;
    }

    // A JSON object answer written as text (optionally fenced).
    static JsonNode jsonObjectIn(String text, ObjectMapper json) {
        var t = text.strip();
        if (t.startsWith("```")) t = t.replaceFirst("^```[a-zA-Z]*\\s*", "").replaceFirst("\\s*```$", "").strip();
        if (!t.startsWith("{") || !t.endsWith("}")) return null;
        try {
            var node = json.readTree(t);
            return node.isObject() ? node : null;
        } catch (Exception e) {
            return null;
        }
    }

    // A chat completion (sync mode) read like a batch output line.
    public static LlmResult fromChatCompletion(String customId, JsonNode body, ObjectMapper json) {
        var line = json.createObjectNode();
        line.put("custom_id", customId == null ? "sync" : customId);
        var response = line.putObject("response");
        response.put("status_code", 200);
        response.set("body", body);
        return parseLine(line, json);
    }

    private static String describe(JsonNode error, String fallback) {
        if (error == null || error.isMissingNode() || error.isNull()) return fallback;
        if (error.isTextual()) return error.asText();
        var msg = textOf(error, "message");
        if (msg == null) msg = textOf(error.path("error"), "message");
        var type = textOf(error, "type");
        return (type == null ? "" : type + ": ") + (msg == null ? error.toString() : msg);
    }

    private static String textOf(JsonNode node, String field) {
        var v = node.path(field);
        return v.isTextual() ? v.asText() : null;
    }
}
