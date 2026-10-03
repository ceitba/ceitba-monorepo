package org.ceitba.api.service.kb.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.ceitba.api.service.drive.SubjectMatcher;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

// Builds the Anthropic `params` of every pipeline request: system prompt
// (versioned resources kb/prompts/<stage>.<version>.md), the user message,
// one forced tool, max_tokens. Also chunking and excerpt selection.
@Component
public class KbPayloads {

    public static final String PROMPT_VERSION = "v2";   // v2: 8k-token digest chunks, bounded digest schema

    // ~20k tokens per digest chunk (chars / 3.5).
    // About 8k input tokens (3.5 chars/token): more parallel requests and a
    // bounded output per call instead of one long pole per large file.
    public static final int CHUNK_CHARS = 28_000;
    // ~12k tokens of raw excerpts per written page.
    static final int EXCERPT_CHARS = 42_000;

    private final ObjectMapper json;
    private final org.ceitba.api.repository.kb.KbModelRepository models;
    private final Map<String, String> prompts = new ConcurrentHashMap<>();

    public KbPayloads(ObjectMapper json, org.ceitba.api.repository.kb.KbModelRepository models) {
        this.json = json;
        this.models = models;
    }

    // params for a pipeline stage with the settings' max_tokens and, for
    // models that support it, reasoning_effort (stageKey: DIGEST|PLAN|WRITE|RETRY).
    public ObjectNode tuned(String model, String stageKey, org.ceitba.api.service.kb.admin.KbEffectiveSettings s,
                            String stable, String variable) {
        return tuned(model, stageKey, s.maxTokens(stageKey), s.reasoningEffort(stageKey), stable, variable);
    }

    public ObjectNode tuned(String model, String stageKey, int maxTokens, String effort, String stable,
                            String variable) {
        var p = params(model, stageKey.toLowerCase(java.util.Locale.ROOT), maxTokens, stable, variable);
        if (effort != null && models.findById(model).map(m -> m.isSupportsReasoningEffort()).orElse(false)) {
            p.put("reasoning_effort", effort);
        }
        return p;
    }

    public String prompt(String stage) {
        return prompts.computeIfAbsent(stage, s -> {
            var r = new ClassPathResource("kb/prompts/" + s + "." + PROMPT_VERSION + ".md");
            try (var in = r.getInputStream()) {
                return new String(in.readAllBytes(), StandardCharsets.UTF_8);
            } catch (IOException e) {
                throw new UncheckedIOException("Missing prompt " + r.getPath(), e);
            }
        });
    }

    public ObjectNode params(String model, String stage, int maxTokens, String userText) {
        return params(model, stage, maxTokens, null, userText);
    }

    // For provider prompt caching the stable part (rules in `system`, then
    // `stable`: the subject and its page index, in a fixed order) comes
    // first and the variable part (digests, excerpts, current page) last,
    // as separate text blocks of the user message.
    public ObjectNode params(String model, String stage, int maxTokens, String stable, String variable) {
        var p = json.createObjectNode();
        p.put("model", model);
        p.put("max_tokens", maxTokens);
        p.put("system", prompt(stage));
        var msg = p.putArray("messages").addObject();
        msg.put("role", "user");
        if (stable == null) {
            msg.put("content", variable);
        } else {
            var content = msg.putArray("content");
            content.addObject().put("type", "text").put("text", "## Contexto\n\n" + stable);
            content.addObject().put("type", "text").put("text", "## Tarea\n\n" + variable);
        }
        var tool = tool(stage);
        p.putArray("tools").add(tool);
        var choice = p.putObject("tool_choice");
        choice.put("type", "tool");
        choice.put("name", tool.path("name").asText());
        return p;
    }

    public String toJson(Object o) {
        try {
            return json.writerWithDefaultPrettyPrinter().writeValueAsString(o);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public static int estimateTokens(JsonNode params) {
        return (int) Math.ceil(params.toString().length() / 3.5);
    }

    // ---- tools ---------------------------------------------------------------

    private ObjectNode boundedStrings(int maxItems, int maxLength) {
        var a = json.createObjectNode().put("type", "array").put("maxItems", maxItems);
        a.putObject("items").put("type", "string").put("maxLength", maxLength);
        return a;
    }

    ObjectNode tool(String stage) {
        var t = json.createObjectNode();
        var schema = json.createObjectNode();
        schema.put("type", "object");
        var props = schema.putObject("properties");
        switch (stage) {
            case "digest" -> {
                t.put("name", "submit_digest");
                t.put("description", "Submit the digest of this chunk");
                // Bounded output (digest.v2.md states the same limits).
                var topic = json.createObjectNode().put("type", "object");
                var tp = topic.putObject("properties");
                tp.putObject("name").put("type", "string").put("maxLength", 80);
                tp.set("aliases", boundedStrings(4, 80));
                tp.putObject("summary").put("type", "string").put("maxLength", 300);
                tp.set("keyPoints", boundedStrings(5, 160));
                tp.set("formulas", boundedStrings(5, 160));
                topic.putArray("required").add("name").add("summary");
                props.putObject("topics").put("type", "array").put("maxItems", 12).set("items", topic);
                props.putObject("materialKind").put("type", "string");
                props.putObject("unitHint").putArray("type").add("string").add("null");
                props.putObject("language").put("type", "string");
                schema.putArray("required").add("topics");
            }
            case "plan" -> {
                t.put("name", "submit_plan");
                t.put("description", "Submit the page operations");
                var op = json.createObjectNode().put("type", "object");
                var opProps = op.putObject("properties");
                opProps.putObject("op").put("type", "string").putArray("enum").add("create").add("update").add("delete");
                opProps.putObject("slug").put("type", "string");
                opProps.putObject("type").put("type", "string").putArray("enum").add("index").add("topic").add("concept");
                opProps.putObject("title").put("type", "string");
                opProps.set("sources", stringArray());
                opProps.putObject("reason").put("type", "string");
                op.putArray("required").add("op").add("slug");
                props.putObject("operations").put("type", "array").set("items", op);
                schema.putArray("required").add("operations");
            }
            default -> {
                t.put("name", "submit_page");
                t.put("description", "Submit the complete page file (frontmatter + Markdown)");
                props.putObject("markdown").put("type", "string");
                schema.putArray("required").add("markdown");
            }
        }
        t.set("input_schema", schema);
        return t;
    }

    private ObjectNode stringArray() {
        var a = json.createObjectNode();
        a.put("type", "array");
        a.putObject("items").put("type", "string");
        return a;
    }

    // ---- chunks and excerpts --------------------------------------------------

    // Splits text into chunks of at most CHUNK_CHARS, at paragraph breaks
    // when possible.
    public static List<String> chunks(String text) {
        var out = new ArrayList<String>();
        if (text == null || text.isBlank()) return out;
        int from = 0;
        while (from < text.length()) {
            int end = Math.min(text.length(), from + CHUNK_CHARS);
            if (end < text.length()) {
                int para = text.lastIndexOf("\n\n", end);
                if (para > from + CHUNK_CHARS / 2) end = para;
            }
            out.add(text.substring(from, end).strip());
            from = end;
        }
        out.removeIf(String::isBlank);
        return out;
    }

    public record Excerpt(String fileId, String name, String text) {}

    public record SourceText(String fileId, String name, String text) {}

    // The paragraphs of the given (added/changed) files most related to the
    // page, kept in document order, within EXCERPT_CHARS overall (split
    // evenly between files).
    public static List<Excerpt> excerpts(List<SourceText> sources, Set<String> keywords) {
        var out = new ArrayList<Excerpt>();
        if (sources.isEmpty()) return out;
        int perFile = EXCERPT_CHARS / sources.size();
        var folded = new HashSet<String>();
        for (var k : keywords) {
            for (var w : SubjectMatcher.normalize(k).split(" ")) if (w.length() >= 4) folded.add(w);
        }
        for (var s : sources) {
            var paragraphs = List.of(s.text().split("\n\\s*\n"));
            record Scored(int index, int score, String text) {}
            var scored = new ArrayList<Scored>();
            for (int i = 0; i < paragraphs.size(); i++) {
                var p = paragraphs.get(i).strip();
                if (p.isEmpty()) continue;
                int score = 0;
                var norm = SubjectMatcher.normalize(p);
                for (var k : folded) if (norm.contains(k)) score++;
                scored.add(new Scored(i, score, p));
            }
            scored.sort(Comparator.comparingInt((Scored x) -> -x.score()).thenComparingInt(Scored::index));
            var chosen = new ArrayList<Scored>();
            int used = 0;
            for (var p : scored) {
                if (used + p.text().length() > perFile) {
                    if (chosen.isEmpty()) {
                        chosen.add(new Scored(p.index(), p.score(), p.text().substring(0, perFile)));
                    }
                    continue;
                }
                chosen.add(p);
                used += p.text().length() + 2;
            }
            chosen.sort(Comparator.comparingInt(Scored::index));
            var sb = new StringBuilder();
            for (var p : chosen) sb.append(p.text()).append("\n\n");
            out.add(new Excerpt(s.fileId(), s.name(), sb.toString().strip()));
        }
        return out;
    }

    public ArrayNode array() {
        return json.createArrayNode();
    }

    public ObjectNode object() {
        return json.createObjectNode();
    }
}
