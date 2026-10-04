package org.ceitba.api.service.kb.eval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.ceitba.api.service.kb.KbPageParser;
import org.ceitba.api.service.kb.KbWikilinks;
import org.ceitba.api.service.kb.pipeline.KbPageFiles;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

// Automatic metrics of an evaluation (docs/SUBJECT-WIKI-ADMIN.md §4), pure so
// they can be tested on fixtures. One PageInput per page a configuration
// wrote: its first-pass draft and errors (after the deterministic linker),
// the unlinked mentions found before the linker, and the final version after
// one retry.
public final class KbEvalMetrics {

    private static final Pattern H2 = Pattern.compile("(?m)^##(?!#)\\s+");
    private static final Pattern CITATION = Pattern.compile("\\[\\[file:");
    private static final Pattern SENTENCE_SPLIT = Pattern.compile("(?<=[.!?])\\s+|\\n+");
    private static final Pattern NUMBER = Pattern.compile("(?<![\\p{L}\\d])\\d+(?:[.,]\\d+)?");
    private static final Pattern MATH = Pattern.compile("\\$[^$\\n]+\\$");
    private static final Pattern MATH_TOKEN = Pattern.compile("[A-Za-z]{2,}");
    private static final Pattern WORD = Pattern.compile("[\\p{L}][\\p{L}\\p{N}'-]*");
    private static final Pattern LINK_WITH_TEXT = Pattern.compile("\\[\\[[^\\[\\]|\\n]+\\|([^\\[\\]\\n]*)]]");
    private static final Pattern LINK = Pattern.compile("\\[\\[[^\\[\\]\\n]+]]");

    private KbEvalMetrics() {}

    public record PageInput(String slug, String firstContent, List<String> firstErrors, int coverageBeforeLinker,
                            String finalContent, List<String> finalErrors, String sourceText) {

        boolean written() { return firstContent != null; }
        boolean firstValid() { return written() && firstErrors.isEmpty(); }
        boolean finalValid() { return (finalContent != null || firstContent != null) && finalErrors.isEmpty(); }
    }

    public record Usage(long inputTokens, long outputTokens, BigDecimal costUsd, int requests, int emptyToolCalls) {}

    public static ObjectNode compute(List<PageInput> pages, int pagesPlanned, Usage usage, Long durationSec,
                                     ObjectMapper json) {
        var m = json.createObjectNode();
        int written = 0;
        int firstValid = 0;
        int finalValid = 0;
        int sections = 0;
        int citations = 0;
        int uncited = 0;
        int coverage = 0;
        int copies = 0;
        long words = 0;
        int finals = 0;
        int crossLinks = 0;
        int anchors = 0;
        int checkable = 0;
        int unsupported = 0;
        Map<String, Integer> reasons = new TreeMap<>();
        for (var p : pages) {
            if (!p.written()) {
                reasons.merge(category(p.firstErrors().isEmpty() ? "no answer" : p.firstErrors().get(0)), 1, Integer::sum);
                continue;
            }
            written++;
            if (p.firstValid()) firstValid++;
            if (p.finalValid()) finalValid++;
            var firstBody = KbPageFiles.split(p.firstContent()).body();
            sections += H2.matcher(firstBody).results().count();
            citations += CITATION.matcher(firstBody).results().count();
            uncited += KbPageParserAccess.sectionsWithoutCitation(firstBody);
            coverage += p.coverageBeforeLinker();
            boolean copied = false;
            for (var e : p.firstErrors()) {
                reasons.merge(category(e), 1, Integer::sum);
                if (e.startsWith("copies")) copied = true;
            }
            if (copied) copies++;
            var fin = p.finalContent() != null ? p.finalContent() : p.firstContent();
            var body = KbPageFiles.split(fin).body();
            finals++;
            words += WORD.matcher(stripLinks(body)).results().count();
            for (var l : KbWikilinks.parse(body, "this", p.slug()).links()) {
                if (!l.subjectId().equals("this")) crossLinks++;
                if (l.anchor() != null) anchors++;
            }
            var g = grounding(body, p.sourceText());
            checkable += g[0];
            unsupported += g[1];
        }
        m.put("pagesPlanned", pagesPlanned);
        m.put("pagesWritten", written);
        m.put("validPages", finalValid);
        m.put("firstPassValidRate", rate(firstValid, written));
        m.put("finalValidRate", rate(finalValid, written));
        var rr = m.putObject("rejectReasons");
        reasons.forEach(rr::put);
        m.put("citationDensity", sections == 0 ? 0 : round((double) citations / sections));
        m.put("uncitedSections", uncited);
        m.put("coverageViolations", coverage);
        m.put("copyViolations", copies);
        m.put("unsupportedClaimsRate", rate(unsupported, checkable));
        m.put("claimsChecked", checkable);
        m.put("groundingIsHeuristic", true);
        m.put("avgWords", finals == 0 ? 0 : Math.round((double) words / finals));
        m.put("crossLinks", crossLinks);
        m.put("anchors", anchors);
        m.put("inputTokens", usage.inputTokens());
        m.put("outputTokens", usage.outputTokens());
        m.put("costUsd", usage.costUsd().setScale(4, RoundingMode.HALF_UP));
        if (finalValid == 0) m.putNull("costPerValidPage");
        else m.put("costPerValidPage", usage.costUsd().divide(BigDecimal.valueOf(finalValid), 4, RoundingMode.HALF_UP));
        m.put("emptyToolCallRate", rate(usage.emptyToolCalls(), usage.requests()));
        if (durationSec == null) m.putNull("durationSec");
        else m.put("durationSec", durationSec);
        return m;
    }

    // Deterministic grounding heuristic: every sentence with a number, a
    // formula or a proper noun needs at least one of those anchors to appear
    // in the cited sources' text or digests. Returns {checkable, unsupported}.
    public static int[] grounding(String body, String sourceText) {
        var source = fold(sourceText == null ? "" : sourceText);
        int checkable = 0;
        int unsupported = 0;
        var text = KbWikilinks.stripCode(body).replaceAll("\\[\\[file:[^\\]]*]]", " ");
        text = LINK.matcher(LINK_WITH_TEXT.matcher(text).replaceAll("$1")).replaceAll(" ");
        for (var raw : SENTENCE_SPLIT.split(text)) {
            var sentence = raw.strip().replaceFirst("^(#+|[-*+]|\\d+[.)])\\s+", "");
            if (sentence.isEmpty() || sentence.startsWith("|")) continue;
            var anchors = new java.util.LinkedHashSet<String>();
            var n = NUMBER.matcher(sentence);
            while (n.find()) anchors.add(n.group().replace(',', '.'));
            var math = MATH.matcher(sentence);
            boolean formula = false;
            while (math.find()) {
                formula = true;
                var t = MATH_TOKEN.matcher(math.group());
                while (t.find()) anchors.add(t.group());
            }
            if (!formula && sentence.contains("=")) formula = true;
            var w = WORD.matcher(sentence);
            boolean first = true;
            while (w.find()) {
                var word = w.group();
                boolean afterColon = w.start() > 1 && sentence.charAt(w.start() - 2) == ':';
                if (!first && !afterColon && word.length() >= 3 && Character.isUpperCase(word.charAt(0))
                        && !word.equals(word.toUpperCase(Locale.ROOT))) {
                    anchors.add(word);
                } else if (!first && word.length() >= 2 && word.equals(word.toUpperCase(Locale.ROOT))
                        && word.chars().allMatch(Character::isLetter)) {
                    anchors.add(word);   // acronyms: VAN, TIR
                }
                first = false;
            }
            if (anchors.isEmpty() && !formula) continue;
            checkable++;
            boolean supported = anchors.stream().anyMatch(a -> source.contains(fold(a)));
            if (!supported) unsupported++;
        }
        return new int[]{checkable, unsupported};
    }

    // A validator error -> its category.
    public static String category(String error) {
        if (error == null) return "other";
        if (error.startsWith("no answer")) return "no_answer";
        for (var r : List.of("latex_format", "meta_section", "self_link", "missing_formula")) if (error.startsWith(r + ":")) return r;
        if (error.contains("has no [[file:")) return "uncited_section";
        if (error.startsWith("copies")) return "copy";
        if (error.startsWith("unlinked mention")) return "unlinked_mention";
        if (error.contains("no heading")) return "anchor";
        if (error.startsWith("source ") || error.startsWith("cites file")) return "source";
        if (error.startsWith("citation ") || error.startsWith("invalid citation")) return "citation_format";
        if (error.startsWith("frontmatter") || error.contains("slug") || error.contains("type: index")
                || error.contains("missing frontmatter") || error.startsWith("empty")) return "frontmatter";
        return "other";
    }

    private static String stripLinks(String body) {
        return LINK.matcher(LINK_WITH_TEXT.matcher(body).replaceAll("$1")).replaceAll(" ");
    }

    static String fold(String s) {
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "").toLowerCase(Locale.ROOT);
    }

    private static double rate(int a, int b) {
        return b == 0 ? 0 : round((double) a / b);
    }

    private static double round(double v) {
        return Math.round(v * 10000) / 10000.0;
    }

    // KbPageParser.sectionsWithoutCitation is package-private there.
    static final class KbPageParserAccess {
        static int sectionsWithoutCitation(String body) {
            return KbPageParser.sectionsWithoutCitationCount(body);
        }
    }
}
