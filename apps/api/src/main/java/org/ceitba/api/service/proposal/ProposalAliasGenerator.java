package org.ceitba.api.service.proposal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.random.RandomGenerator;

// Picks a pseudonym "<GreekLetter><Color>" (e.g. "AlfaRojo", the format the
// Firestore app used) that is not yet taken on a proposal. Once all
// letter x color combinations are used, a numeric suffix is added
// ("AlfaRojo2"), so generation always terminates.
@Component
public class ProposalAliasGenerator {

    private static final String WORDS = "/proposals/alias-words.json";
    private static final Locale SPANISH = Locale.forLanguageTag("es");

    private final List<String> combos;
    private final RandomGenerator random;

    public ProposalAliasGenerator() {
        this(loadCombos(), new SecureRandom());
    }

    ProposalAliasGenerator(List<String> combos, RandomGenerator random) {
        if (combos.isEmpty()) throw new IllegalArgumentException("alias word list is empty");
        this.combos = List.copyOf(combos);
        this.random = random;
    }

    public String next(Set<String> taken) {
        List<String> free = new ArrayList<>(combos.size());
        for (String c : combos) {
            if (!taken.contains(c)) free.add(c);
        }
        if (!free.isEmpty()) return free.get(random.nextInt(free.size()));

        String base = combos.get(random.nextInt(combos.size()));
        for (int n = 2; ; n++) {
            String candidate = base + n;
            if (!taken.contains(candidate)) return candidate;
        }
    }

    int size() {
        return combos.size();
    }

    static List<String> loadCombos() {
        try (InputStream in = ProposalAliasGenerator.class.getResourceAsStream(WORDS)) {
            if (in == null) throw new IllegalStateException("missing " + WORDS);
            JsonNode root = new ObjectMapper().readTree(in);
            List<String> out = new ArrayList<>();
            for (JsonNode letter : root.get("greekLetters")) {
                for (JsonNode color : root.get("colors")) {
                    out.add(titleCase(letter.asText()) + titleCase(color.asText()));
                }
            }
            return out;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String titleCase(String word) {
        String w = word.trim().toLowerCase(SPANISH);
        return w.isEmpty() ? w : w.substring(0, 1).toUpperCase(SPANISH) + w.substring(1);
    }
}
