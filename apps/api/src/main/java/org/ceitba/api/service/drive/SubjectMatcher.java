package org.ceitba.api.service.drive;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
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
//   2. Otherwise token overlap, accent- and case-insensitive. Tokens are
//      light-stemmed (plural "s" and a final vowel dropped, so Matemática ~
//      Matemático ~ Matemáticas); a name token of 4+ letters also matches a
//      subject token it is a prefix of ("Mate", "Proba", "Metodo", "Estad");
//      a few short abbreviations are expanded ("Fís", "AM", "EDA", "POO").
//      Filler words (resumen, apuntes, teoría, práctica, tp, parcial, final,
//      de, la, ...) never count. Numerals I-VI and 1-6 are the same thing and
//      are compared apart from words: a name numeral that contradicts the
//      subject's ("Física 2" vs Física I) rules the subject out; a name
//      without one does not. Dates ("5/5/20") are ignored.
//      Score = share of the subject's words present in the name, with at
//      least one word matched.
//   3. The student's plan subjects are tried first with a lower threshold
//      (PLAN_THRESHOLD); only without a plan match, all subjects with
//      THRESHOLD. Ties: higher score, then the subject whose first word
//      matched, then earlier in the plan (year/semester), then more words,
//      then name.
public final class SubjectMatcher {

    static final double THRESHOLD = 0.75;
    static final double PLAN_THRESHOLD = 0.5;

    private static final Pattern CODE = Pattern.compile("(?<!\\d)(\\d{2})[.\\-_ ]?(\\d{2})(?!\\d)");
    private static final Pattern DATE = Pattern.compile("\\d{1,2}[/\\-.]\\d{1,2}([/\\-.]\\d{2,4})?");
    private static final Pattern LETTER_DIGIT = Pattern.compile("(?<=[a-z])(?=\\d)|(?<=\\d)(?=[a-z])");

    private static final Set<String> STOPWORDS = Set.of(
        "de", "del", "la", "las", "el", "los", "y", "e", "a", "en", "para", "con", "al", "o", "u", "por", "sus",
        "the", "of", "and",
        "resumen", "resumenes", "apunte", "apuntes", "teoria", "teorica", "teoricas", "practica", "practicas",
        "tp", "tps", "parcial", "parciales", "final", "finales", "full", "completo", "completa", "clase", "clases",
        "guia", "guias", "ejercicio", "ejercicios", "notas", "material", "copia", "ingreso");
    private static final Set<String> NUMERALS = Set.of("i", "ii", "iii", "iv", "v", "vi");
    private static final Map<String, String> ARABIC = Map.of(
        "1", "i", "2", "ii", "3", "iii", "4", "iv", "5", "v", "6", "vi");
    // Short abbreviations (too short for the prefix rule) -> words.
    private static final Map<String, List<String>> ABBREVIATIONS = Map.of(
        "fis", List.of("fisica"),
        "am", List.of("analisis", "matematico"),
        "eda", List.of("estructuras", "datos", "algoritmos"),
        "poo", List.of("programacion", "orientada", "objetos"),
        "pi", List.of("programacion", "imperativa"),
        "md", List.of("matematica", "discreta"),
        "qca", List.of("quimica"));

    private record Tokens(Set<String> words, Set<String> numerals, String firstWord) {}

    private record Candidate(String id, String name, Tokens tokens, int planOrder) {}

    private record Scored(Candidate c, double score, boolean leading, int matched) {}

    private final Set<String> codes = new HashSet<>();
    private final List<Candidate> all = new ArrayList<>();
    private final List<Candidate> plan = new ArrayList<>();

    // subjects: id (code like "93.41") -> name.
    public SubjectMatcher(Map<String, String> subjects) {
        this(subjects, List.of());
    }

    // planSubjectIds: the student's plan subjects in plan order (year, semester).
    public SubjectMatcher(Map<String, String> subjects, List<String> planSubjectIds) {
        Map<String, Integer> order = new java.util.HashMap<>();
        for (int i = 0; i < planSubjectIds.size(); i++) order.putIfAbsent(planSubjectIds.get(i), i);
        subjects.forEach((id, name) -> {
            codes.add(id);
            var tokens = tokens(name);
            if (tokens.words().isEmpty()) return;
            var c = new Candidate(id, name, tokens, order.getOrDefault(id, Integer.MAX_VALUE));
            all.add(c);
            if (order.containsKey(id)) plan.add(c);
        });
    }

    public Optional<String> match(String text) {
        if (text == null || text.isBlank()) return Optional.empty();
        var m = CODE.matcher(text);
        while (m.find()) {
            var code = m.group(1) + "." + m.group(2);
            if (codes.contains(code)) return Optional.of(code);
        }
        var name = tokens(text);
        if (name.words().isEmpty()) return Optional.empty();
        var inPlan = best(plan, name, PLAN_THRESHOLD);
        if (inPlan.isPresent()) return inPlan;
        return best(all, name, THRESHOLD);
    }

    private static Optional<String> best(List<Candidate> candidates, Tokens name, double threshold) {
        return candidates.stream()
            .map(c -> score(c, name))
            .filter(s -> s != null && s.score() >= threshold)
            .min(Comparator.comparingDouble((Scored s) -> -s.score())
                .thenComparing(s -> !s.leading())
                .thenComparingInt(s -> s.c().planOrder())
                .thenComparingInt(s -> -s.matched())
                .thenComparing(s -> s.c().name()))
            .map(s -> s.c().id());
    }

    private static Scored score(Candidate c, Tokens name) {
        var subject = c.tokens();
        if (!name.numerals().isEmpty() && !subject.numerals().isEmpty()
                && java.util.Collections.disjoint(name.numerals(), subject.numerals())) {
            return null;
        }
        int matched = 0;
        boolean leading = false;
        for (var w : subject.words()) {
            if (matches(name.words(), w)) {
                matched++;
                if (w.equals(subject.firstWord())) leading = true;
            }
        }
        if (matched == 0) return null;
        return new Scored(c, (double) matched / subject.words().size(), leading, matched);
    }

    private static boolean matches(Set<String> nameWords, String subjectWord) {
        if (nameWords.contains(subjectWord)) return true;
        for (var n : nameWords) {
            if (n.length() >= 4 && subjectWord.startsWith(n)) return true;
        }
        return false;
    }

    static Tokens tokens(String s) {
        var text = DATE.matcher(normalizeRaw(s)).replaceAll(" ");
        text = LETTER_DIGIT.matcher(text).replaceAll(" ");
        var words = new LinkedHashSet<String>();
        var numerals = new LinkedHashSet<String>();
        String first = null;
        for (var raw : text.replaceAll("[^a-z0-9]+", " ").trim().split(" ")) {
            if (raw.isEmpty() || STOPWORDS.contains(raw)) continue;
            var numeral = ARABIC.getOrDefault(raw, raw);
            if (NUMERALS.contains(numeral)) {
                numerals.add(numeral);
                continue;
            }
            if (raw.chars().allMatch(Character::isDigit)) continue;
            var expanded = ABBREVIATIONS.getOrDefault(raw, List.of(raw));
            for (var w : expanded) {
                if (STOPWORDS.contains(w)) continue;
                var stem = stem(w);
                if (first == null) first = stem;
                words.add(stem);
            }
        }
        return new Tokens(words, numerals, first);
    }

    // matematicas -> matematic, fisica -> fisic, datos -> dat.
    static String stem(String w) {
        var s = w;
        if (s.length() > 4 && s.endsWith("s")) s = s.substring(0, s.length() - 1);
        if (s.length() > 4 && "aeo".indexOf(s.charAt(s.length() - 1)) >= 0) s = s.substring(0, s.length() - 1);
        return s;
    }

    private static String normalizeRaw(String s) {
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "").toLowerCase(Locale.ROOT);
    }

    public static String normalize(String s) {
        return normalizeRaw(s).replaceAll("[^a-z0-9]+", " ").trim();
    }
}
