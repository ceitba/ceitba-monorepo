package org.ceitba.api.service.kb.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.ceitba.api.service.drive.SubjectMatcher;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

// Deterministic merge of a multi-chunk file's digests (no LLM): topics in
// order, same-name topics (accent/case-insensitive) merged; materialKind,
// unitHint and language from the first chunk that has them.
public final class KbDigests {

    private KbDigests() {}

    public static ObjectNode merge(List<JsonNode> chunks, ObjectMapper json) {
        var out = json.createObjectNode();
        Map<String, ObjectNode> topics = new LinkedHashMap<>();
        for (var c : chunks) {
            if (c == null) continue;
            for (var field : List.of("materialKind", "unitHint", "language")) {
                if (!out.hasNonNull(field) && c.hasNonNull(field)) out.set(field, c.get(field));
            }
            for (var t : c.path("topics")) {
                var name = t.path("name").asText("").strip();
                if (name.isEmpty()) continue;
                var key = SubjectMatcher.normalize(name);
                var existing = topics.get(key);
                if (existing == null) {
                    topics.put(key, (ObjectNode) t.deepCopy());
                    continue;
                }
                for (var list : List.of("aliases", "keyPoints", "formulas")) {
                    var merged = new LinkedHashSet<String>();
                    existing.path(list).forEach(v -> merged.add(v.asText()));
                    t.path(list).forEach(v -> merged.add(v.asText()));
                    var arr = existing.putArray(list);
                    merged.forEach(arr::add);
                }
                var summary = existing.path("summary").asText("");
                var more = t.path("summary").asText("");
                if (!more.isBlank() && !summary.contains(more)) existing.put("summary", (summary + " " + more).strip());
            }
        }
        var arr = out.putArray("topics");
        topics.values().forEach(arr::add);
        return out;
    }
}
