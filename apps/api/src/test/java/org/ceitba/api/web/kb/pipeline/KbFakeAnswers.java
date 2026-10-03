package org.ceitba.api.web.kb.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.external.llm.FakeLlmRequest;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.function.Function;
import java.util.regex.Pattern;

// Plausible structured answers for the fake executors: a digest, a plan with
// one concept page per subject citing every changed file, and a page body
// that passes validation (or, with badFirstWrite, a WRITE without citations
// that only the RETRY fixes).
public final class KbFakeAnswers {

    static final Pattern FILE_ID = Pattern.compile("\"fileId\"\\s*:\\s*\"([0-9a-f-]{36})\"");

    private KbFakeAnswers() {}

    public static Function<FakeLlmRequest, JsonNode> responder(ObjectMapper json, boolean badFirstWrite) {
        return r -> {
            var ids = ids(r.userText());
            switch (r.toolName()) {
                case "submit_digest" -> {
                    var o = json.createObjectNode();
                    var t = o.putArray("topics").addObject();
                    t.put("name", "Interés compuesto");
                    t.put("summary", "Capitalización de intereses período a período.");
                    return o;
                }
                case "submit_plan" -> {
                    var o = json.createObjectNode();
                    var op = o.putArray("operations").addObject();
                    op.put("op", "create");
                    op.put("slug", "conceptos-centrales");
                    op.put("type", "concept");
                    op.put("title", "Conceptos centrales");
                    var arr = op.putArray("sources");
                    ids.forEach(arr::add);
                    op.put("reason", "material nuevo");
                    return o;
                }
                case "submit_page" -> {
                    boolean retry = r.userText().contains("\"errors\"");
                    var cite = ids.isEmpty() ? "" : " [[file:" + ids.get(0) + "]]";
                    var o = json.createObjectNode();
                    o.put("markdown", "## Resumen\n\nUna explicación breve con palabras propias sobre la idea "
                        + "principal del material de la cursada." + (badFirstWrite && !retry ? "" : cite) + "\n");
                    return o;
                }
                default -> {
                    return null;
                }
            }
        };
    }

    static List<String> ids(String text) {
        var out = new LinkedHashSet<String>();
        var m = FILE_ID.matcher(text == null ? "" : text);
        while (m.find()) out.add(m.group(1));
        return new ArrayList<>(out);
    }
}
