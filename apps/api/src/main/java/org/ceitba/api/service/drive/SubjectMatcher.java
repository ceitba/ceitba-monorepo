package org.ceitba.api.service.drive;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

// Suggests a subject for a Drive file/folder name. Deliberately simple:
//
//   1. A subject code in the name ("93.41", "93-41", "9341") wins outright.
//   2. Otherwise, accent-insensitive token overlap: the share of the
//      subject's significant tokens present in the name must be >= 0.75 and
//      at least one matched token must be a word (not just a numeral).
//      Arabic 1-6 count as roman numerals, so "Fisica 2" matches "Física II"
//      and not "Física I". Ties go to the subject with more matched tokens,
//      then the lower code.
public final class SubjectMatcher {

    static final double THRESHOLD = 0.75;

    private static final Pattern CODE = Pattern.compile("(?<!\\d)(\\d{2})[.\\-_ ]?(\\d{2})(?!\\d)");
    private static final Set<String> STOPWORDS = Set.of(
        "de", "del", "la", "las", "el", "los", "y", "e", "a", "en", "para", "con", "al", "o", "u", "the", "of", "and");
    private static final Set<String> NUMERALS = Set.of("i", "ii", "iii", "iv", "v", "vi");
    private static final Map<String, String> ARABIC = Map.of(
        "1", "i", "2", "ii", "3", "iii", "4", "iv", "5", "v", "6", "vi");

    private record Candidate(String id, Set<String> tokens) {}

    private final Set<String> codes = new HashSet<>();
    private final List<Candidate> candidates = new ArrayList<>();

    // subjects: id (code like "93.41") -> name.
    public SubjectMatcher(Map<String, String> subjects) {
        subjects.forEach((id, name) -> {
            codes.add(id);
            var tokens = tokens(name);
            if (!tokens.isEmpty()) candidates.add(new Candidate(id, tokens));
        });
    }

    public Optional<String> match(String text) {
        if (text == null || text.isBlank()) return Optional.empty();
        var m = CODE.matcher(text);
        while (m.find()) {
            var code = m.group(1) + "." + m.group(2);
            if (codes.contains(code)) return Optional.of(code);
        }
        var words = tokens(text);
        if (words.isEmpty()) return Optional.empty();

        String best = null;
        double bestScore = 0;
        int bestMatched = 0;
        for (var c : candidates) {
            int matched = 0;
            boolean wordMatched = false;
            for (var t : c.tokens()) {
                if (words.contains(t)) {
                    matched++;
                    if (!NUMERALS.contains(t)) wordMatched = true;
                }
            }
            if (!wordMatched) continue;
            double score = (double) matched / c.tokens().size();
            if (score < THRESHOLD) continue;
            boolean better = score > bestScore
                || (score == bestScore && matched > bestMatched)
                || (score == bestScore && matched == bestMatched && best != null && c.id().compareTo(best) < 0);
            if (better) {
                best = c.id();
                bestScore = score;
                bestMatched = matched;
            }
        }
        return Optional.ofNullable(best);
    }

    // "Análisis Matemático II" -> [analisis, matematico, ii]
    static Set<String> tokens(String s) {
        var out = new LinkedHashSet<String>();
        for (var raw : normalize(s).split(" ")) {
            if (raw.isEmpty() || STOPWORDS.contains(raw)) continue;
            out.add(ARABIC.getOrDefault(raw, raw));
        }
        return out;
    }

    public static String normalize(String s) {
        var noAccents = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
        return noAccents.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
    }
}
