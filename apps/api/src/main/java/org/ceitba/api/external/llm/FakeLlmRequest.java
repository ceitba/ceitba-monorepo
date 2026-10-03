package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.JsonNode;

// What the fakes (FakeLlmBatchClient, FakeSyncChatClient) hand to a
// responder: the forced tool, the system prompt and the user text, whatever
// the wire format. customId is null in sync mode.
public record FakeLlmRequest(String customId, String model, String toolName, String system, String userText,
                             JsonNode raw) {

    // Anthropic Messages params (batch lines).
    static FakeLlmRequest fromAnthropic(String customId, JsonNode params) {
        var sb = new StringBuilder();
        for (var m : params.path("messages")) {
            var c = m.path("content");
            if (c.isTextual()) sb.append(c.asText());
            for (var b : c) if (b.hasNonNull("text")) sb.append(b.path("text").asText());
        }
        return new FakeLlmRequest(customId, params.path("model").asText(null),
            params.path("tool_choice").path("name").asText(null), params.path("system").asText(""), sb.toString(),
            params);
    }

    // OpenAI chat completion bodies (sync mode, openai batch lines).
    static FakeLlmRequest fromChat(String customId, JsonNode body) {
        var sb = new StringBuilder();
        var system = new StringBuilder();
        for (var m : body.path("messages")) {
            var target = m.path("role").asText().equals("system") ? system : sb;
            var c = m.path("content");
            if (c.isTextual()) target.append(c.asText());
            for (var b : c) if (b.hasNonNull("text")) target.append(b.path("text").asText());
        }
        var tool = body.path("tool_choice").path("function").path("name").asText(null);
        if (tool == null) {
            // json_object fallback: the tool is named in the system prompt.
            var m = java.util.regex.Pattern.compile("JSON schema of (\\w+):").matcher(system);
            if (m.find()) tool = m.group(1);
        }
        return new FakeLlmRequest(customId, body.path("model").asText(null), tool, system.toString(), sb.toString(),
            body);
    }
}
