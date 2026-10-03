package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

// In-memory chat completions (kb.llm.use-fake=true). The responder returns
// the structured answer (or null for a failed request). With
// toolCalls(false) the answer comes back as JSON in the message content
// (exercises the content-json fallback); with
// failToolCallsUntilJsonObject(true) the first try returns plain prose and
// only a request with response_format json_object gets the JSON.
public class FakeSyncChatClient implements SyncChatClient {

    private final ObjectMapper json;
    private final List<FakeLlmRequest> received = java.util.Collections.synchronizedList(new ArrayList<>());
    private volatile Function<FakeLlmRequest, JsonNode> responder = r -> null;
    private volatile boolean toolCalls = true;
    private volatile boolean proseUnlessJsonObject;
    private volatile List<String> models = List.of("glm-5.3", "glm-5.3-flash", "anthropic-claude-haiku-4.5");

    public FakeSyncChatClient(ObjectMapper json) {
        this.json = json;
    }

    public void reset() {
        received.clear();
        responder = r -> null;
        toolCalls = true;
        proseUnlessJsonObject = false;
    }

    public void respond(Function<FakeLlmRequest, JsonNode> responder) {
        this.responder = responder;
    }

    public void toolCalls(boolean toolCalls) {
        this.toolCalls = toolCalls;
    }

    public void proseUnlessJsonObject(boolean on) {
        this.proseUnlessJsonObject = on;
    }

    public void models(List<String> models) {
        this.models = List.copyOf(models);
    }

    public List<FakeLlmRequest> received() {
        return List.copyOf(received);
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public JsonNode complete(JsonNode body) {
        var req = FakeLlmRequest.fromChat(null, body);
        received.add(req);
        JsonNode answer;
        try {
            answer = responder.apply(req);
        } catch (RuntimeException e) {
            answer = null;
        }
        if (answer == null) throw new LlmApiException(400, "fake: no scripted answer");
        var out = json.createObjectNode();
        out.put("id", "chatcmpl-fake");
        out.put("model", body.path("model").asText());
        var msg = out.putArray("choices").addObject().putObject("message");
        msg.put("role", "assistant");
        boolean jsonObject = body.path("response_format").path("type").asText("").equals("json_object");
        if (proseUnlessJsonObject && !jsonObject) {
            msg.put("content", "Claro, acá va mi respuesta en prosa.");
        } else if (toolCalls && req.toolName() != null) {
            var call = msg.putArray("tool_calls").addObject();
            call.put("id", "call_1");
            call.put("type", "function");
            call.putObject("function").put("name", req.toolName()).put("arguments", answer.toString());
            msg.putNull("content");
        } else {
            msg.put("content", answer.toString());
        }
        var usage = out.putObject("usage");
        int prompt = body.toString().length() / 4;
        usage.put("prompt_tokens", prompt);
        usage.put("completion_tokens", answer.toString().length() / 4);
        usage.putObject("prompt_tokens_details").put("cached_tokens", prompt / 2);
        return out;
    }

    @Override
    public List<String> listModels() {
        return models;
    }
}
