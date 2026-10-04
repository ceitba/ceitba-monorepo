package org.ceitba.api.service.kb;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

// The plan's `mustCover` list of a page: what the page must present (definitions,
// methods, formulas). Never a reason to drop a plan op: bad input becomes [].
public final class KbMustCover {

    public static final String MISSING_FORMULA = "missing_formula";
    public static final int MAX_ITEMS = 10;
    public static final int MAX_CHARS = 300;

    private KbMustCover() {}

    // A backslash command, or ^ / _ followed by a brace: the item is a formula.
    private static final Pattern LATEX = Pattern.compile("\\\\[A-Za-z]+|[\\^_]\\{");

    // The trimmed, non-blank strings of `node` (max 10, each cut to 300 chars).
    public static ArrayNode normalize(JsonNode node) {
        var out = JsonNodeFactory.instance.arrayNode();
        if (node == null || !node.isArray()) return out;
        for (var n : node) {
            if (!n.isTextual()) continue;
            var s = n.asText().strip();
            if (s.isEmpty()) continue;
            out.add(s.length() > MAX_CHARS ? s.substring(0, MAX_CHARS) : s);
            if (out.size() >= MAX_ITEMS) break;
        }
        return out;
    }

    // The reject reason when the plan required formulas and the body has no $ math at all.
    public static List<String> missingFormulaErrors(JsonNode mustCover, String body) {
        var out = new ArrayList<String>();
        if (mustCover == null || !mustCover.isArray()) return out;
        String first = null;
        for (var n : mustCover) {
            if (n.isTextual() && LATEX.matcher(n.asText()).find()) {
                first = n.asText().strip();
                break;
            }
        }
        if (first == null) return out;
        if (!KbStyleChecks.splitMath(KbWikilinks.stripCode(body == null ? "" : body)).spans().isEmpty()) return out;
        var preview = first.length() <= 80 ? first : first.substring(0, 77) + "...";
        out.add(MISSING_FORMULA + ": the plan required formulas (" + preview + ") but the page has none");
        return out;
    }
}
