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

    // Like merge, for a file some of whose chunks failed (null entries, by chunk
    // index): the digest of the ones that worked, flagged
    // partial: true with failedChunks (0-based indexes). All present: plain merge.
    public static ObjectNode mergePartial(List<JsonNode> chunks, ObjectMapper json) {
        var out = merge(chunks, json);
        var failed = new java.util.ArrayList<Integer>();
        for (int i = 0; i < chunks.size(); i++) if (chunks.get(i) == null) failed.add(i);
        if (!failed.isEmpty()) {
            out.put("partial", true);
            var arr = out.putArray("failedChunks");
            failed.forEach(arr::add);
        }
        return out;
    }

    // Subjects' files without a digest: the ones to leave out of the run, or
    // null when the subject must fail (all of them, or more than maxRatio).
    public static List<String> tolerableMissing(List<String> missing, int total, double maxRatio) {
        if (missing.isEmpty()) return missing;
        if (missing.size() >= total || missing.size() > total * maxRatio) return null;
        return missing;
    }

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
