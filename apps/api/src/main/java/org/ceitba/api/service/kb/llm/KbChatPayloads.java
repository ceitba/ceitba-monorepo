package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

// Wire formats of one canonical request (Anthropic Messages `params`:
// model, max_tokens, system, messages, tools[{name, description,
// input_schema}], tool_choice {type: tool, name}). The canonical form is
// what the pipeline stores (kb/runs/<runId>/<stage>.jsonl), in every mode.
public final class KbChatPayloads {

    public static final String CHAT_ENDPOINT = "/v1/chat/completions";

    private KbChatPayloads() {}

    // The DO batch provider of a model id (anthropic | openai), or null.
    public static String batchProvider(String model) {
        if (model == null) return null;
        if (model.startsWith("anthropic-")) return "anthropic";
        if (model.startsWith("openai-")) return "openai";
        return null;
    }

    // The model id batch JSONL lines use when the catalog has none: DO's
    // batch API takes native provider ids (gpt-6-luna, claude-haiku-4.5)
    // where serverless chat takes the catalog id (openai-gpt-6-luna).
    public static String defaultBatchModelId(String model) {
        if (model == null) return null;
        for (var prefix : new String[]{"openai-", "anthropic-"}) {
            if (model.startsWith(prefix) && model.length() > prefix.length()) return model.substring(prefix.length());
        }
        return model;
    }

    // The other form of a batch model id (native <-> prefixed catalog id),
    // or null when the catalog id has no provider prefix.
    public static String otherBatchModelId(String catalogId, String tried) {
        var nativeId = defaultBatchModelId(catalogId);
        if (nativeId == null || nativeId.equals(catalogId)) return null;
        return catalogId.equals(tried) ? nativeId : catalogId;
    }

    // Default batch rule (ADMIN doc §7): commercial OpenAI/Anthropic models
    // only; DO-hosted open-weight models (GLM, DeepSeek, Qwen, Kimi, gpt-oss,
    // Llama...) have none. A batch probe overrides it in the catalog.
    public static boolean batchByRule(String model) {
        if (model == null) return false;
        if (model.startsWith("anthropic-")) return true;
        return model.startsWith("openai-") && !model.contains("gpt-oss") && !model.contains("llama");
    }

    // One batch JSONL line in the provider's format; batchModelId replaces
    // the catalog id of params.model (null keeps it).
    public static ObjectNode batchLine(String customId, JsonNode params, String provider, String batchModelId,
                                       ObjectMapper json) {
        var line = json.createObjectNode();
        line.put("custom_id", customId);
        if ("openai".equals(provider)) {
            line.put("method", "POST");
            line.put("url", CHAT_ENDPOINT);
            var body = chatBody(params, false, json);
            if (batchModelId != null) body.put("model", batchModelId);
            // Batch bodies reach OpenAI as-is (serverless chat translates for
            // us): the GPT-5 family rejects max_tokens, so every request in the
            // batch failed with no error file. max_completion_tokens works for
            // all OpenAI chat models.
            var max = body.remove("max_tokens");
            if (max != null) body.set("max_completion_tokens", max);
            line.set("body", body);
        } else {
            var p = params.deepCopy();
            if (p instanceof ObjectNode o) {
                o.remove("reasoning_effort");   // not an Anthropic Messages field
                if (batchModelId != null) o.put("model", batchModelId);
            }
            line.set("params", p);
        }
        return line;
    }

    public static ObjectNode batchLine(String customId, JsonNode params, String provider, ObjectMapper json) {
        return batchLine(customId, params, provider, null, json);
    }

    // OpenAI-compatible chat completion body. jsonObjectFallback: no tools,
    // response_format json_object and the tool's schema in the system prompt.
    public static ObjectNode chatBody(JsonNode params, boolean jsonObjectFallback, ObjectMapper json) {
        var body = json.createObjectNode();
        body.put("model", params.path("model").asText());
        body.put("max_tokens", params.path("max_tokens").asInt(4096));
        if (params.hasNonNull("reasoning_effort")) body.put("reasoning_effort", params.path("reasoning_effort").asText());
        var messages = body.putArray("messages");
        var tool = params.path("tools").path(0);
        var system = params.path("system").asText("");
        if (jsonObjectFallback && tool.isObject()) {
            system += "\n\nAnswer with only a JSON object (no prose, no code fences) that matches the JSON schema of "
                + tool.path("name").asText("the answer") + ":\n" + tool.path("input_schema");
        }
        messages.addObject().put("role", "system").put("content", system);
        for (var m : params.path("messages")) {
            var content = m.path("content");
            String text;
            if (content.isTextual()) {
                text = content.asText();
            } else {
                var sb = new StringBuilder();
                for (var b : content) if (b.hasNonNull("text")) sb.append(b.path("text").asText());
                text = sb.toString();
            }
            messages.addObject().put("role", m.path("role").asText("user")).put("content", text);
        }
        if (jsonObjectFallback) {
            body.putObject("response_format").put("type", "json_object");
        } else if (tool.isObject()) {
            var fn = body.putArray("tools").addObject().put("type", "function").putObject("function");
            fn.put("name", tool.path("name").asText());
            fn.put("description", tool.path("description").asText(""));
            fn.set("parameters", tool.path("input_schema"));
            body.putObject("tool_choice").put("type", "function").putObject("function")
                .put("name", tool.path("name").asText());
        }
        return body;
    }
}
