package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.ceitba.api.external.llm.LlmOutputParser;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

// Wire formats (canonical Anthropic params -> chat / batch lines) and the
// defensive output parser.
class KbChatPayloadsTest {

    final ObjectMapper json = new ObjectMapper();

    ObjectNode params() throws Exception {
        return (ObjectNode) json.readTree("""
            {"model":"glm-5.3","max_tokens":6000,"reasoning_effort":"low","system":"reglas",
             "tools":[{"name":"submit_plan","description":"d","input_schema":{"type":"object"}}],
             "tool_choice":{"type":"tool","name":"submit_plan"},
             "messages":[{"role":"user","content":[{"type":"text","text":"## Contexto"},{"type":"text","text":"## Tarea"}]}]}
            """);
    }

    @Test
    void chatBodyForcesTheToolAndKeepsReasoningEffort() throws Exception {
        var body = KbChatPayloads.chatBody(params(), false, json);
        assertThat(body.path("tool_choice").path("function").path("name").asText()).isEqualTo("submit_plan");
        assertThat(body.path("reasoning_effort").asText()).isEqualTo("low");
        assertThat(body.path("messages").get(0).path("content").asText()).isEqualTo("reglas");
        assertThat(body.path("messages").get(1).path("content").asText()).isEqualTo("## Contexto## Tarea");
        var fallback = KbChatPayloads.chatBody(params(), true, json);
        assertThat(fallback.has("tools")).isFalse();
        assertThat(fallback.path("response_format").path("type").asText()).isEqualTo("json_object");
        assertThat(fallback.path("messages").get(0).path("content").asText()).contains("submit_plan");
    }

    @Test
    void anthropicBatchLinesDropReasoningEffort() throws Exception {
        var line = KbChatPayloads.batchLine("abc-P-000001", params(), "anthropic", json);
        assertThat(line.path("params").has("reasoning_effort")).isFalse();
        var openai = KbChatPayloads.batchLine("abc-P-000001", params(), "openai", json);
        assertThat(openai.path("url").asText()).isEqualTo("/v1/chat/completions");
        assertThat(openai.path("body").path("model").asText()).isEqualTo("glm-5.3");
    }

    @Test
    void parserHandlesToolCallsContentJsonEmptyAndTruncated() throws Exception {
        var ok = LlmOutputParser.fromChatCompletion("x", json.readTree("""
            {"choices":[{"finish_reason":"tool_calls","message":{"reasoning_content":"pienso",
              "tool_calls":[{"function":{"name":"submit_plan","arguments":"{\\"operations\\":[]}"}}]}}],
             "usage":{"prompt_tokens":100,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":40}}}
            """), json);
        assertThat(ok.ok()).isTrue();
        assertThat(ok.toolInput().has("operations")).isTrue();
        assertThat(ok.cachedTokens()).isEqualTo(40);
        assertThat(ok.path()).isEqualTo("tool");

        var content = LlmOutputParser.fromChatCompletion("x", json.readTree("""
            {"choices":[{"finish_reason":"stop","message":{"content":"```json\\n{\\"markdown\\":\\"hola\\"}\\n```"}}]}
            """), json);
        assertThat(content.toolInput().path("markdown").asText()).isEqualTo("hola");
        assertThat(content.path()).isEqualTo("content-json");

        var empty = LlmOutputParser.fromChatCompletion("x", json.readTree("""
            {"choices":[{"finish_reason":"tool_calls","message":{"tool_calls":[{"function":{"name":"submit_plan","arguments":""}}]}}]}
            """), json);
        assertThat(empty.ok()).isFalse();
        assertThat(empty.error()).startsWith("EMPTY_TOOL");

        var cut = LlmOutputParser.fromChatCompletion("x", json.readTree("""
            {"choices":[{"finish_reason":"length","message":{"content":""}}]}
            """), json);
        assertThat(cut.ok()).isFalse();
        assertThat(cut.error()).startsWith("TRUNCATED");
    }

    @Test
    void parserReadsAnthropicBatchResults() {
        var jsonl = """
            {"custom_id":"a","result":{"type":"succeeded","message":{"stop_reason":"tool_use","content":[{"type":"tool_use","name":"submit_page","input":{"markdown":"x"}}],"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":3}}}}
            {"custom_id":"b","result":{"type":"errored","error":{"type":"invalid_request_error","message":"bad"}}}
            """;
        var out = LlmOutputParser.parse(jsonl.getBytes(StandardCharsets.UTF_8), json);
        assertThat(out.get("a").ok()).isTrue();
        assertThat(out.get("a").cachedTokens()).isEqualTo(3);
        assertThat(out.get("b").ok()).isFalse();
    }
}
