package org.ceitba.api.service.kb;

import java.text.Normalizer;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

// "Never more than 40 consecutive words copied from a source": a page is
// rejected when any run of WINDOW consecutive words of its body also appears
// in a source's extracted text. Both sides are normalized (lowercase,
// accents kept, wikilink syntax and punctuation/Markdown dropped, whitespace
// collapsed) so formatting cannot hide a copy. Runs are compared as 64-bit
// hashes of their word sequence.
public final class KbCopyDetector {

    public static final int WINDOW = 40;

    private KbCopyDetector() {}

    // The first copied run (as text, up to WINDOW words) or null.
    public static String findCopy(String pageBody, List<String> sourceTexts) {
        var page = words(stripLinks(pageBody));
        if (page.length < WINDOW) return null;
        for (var source : sourceTexts) {
            if (source == null) continue;
            var src = words(source);
            if (src.length < WINDOW) continue;
            var shingles = shingles(src);
            for (int i = 0; i + WINDOW <= page.length; i++) {
                if (shingles.contains(hash(page, i))) return String.join(" ", java.util.Arrays.copyOfRange(page, i, i + WINDOW));
            }
        }
        return null;
    }

    static String[] words(String text) {
        var n = Normalizer.normalize(text, Normalizer.Form.NFC).toLowerCase(Locale.ROOT)
            .replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
        return n.isEmpty() ? new String[0] : n.split(" ");
    }

    // [[target|text]] -> text, [[target]] -> nothing (not prose).
    static String stripLinks(String body) {
        return body.replaceAll("\\[\\[[^\\[\\]|\\n]+\\|([^\\[\\]\\n]*)]]", "$1")
            .replaceAll("\\[\\[[^\\[\\]\\n]+]]", " ");
    }

    private static Set<Long> shingles(String[] words) {
        var out = new HashSet<Long>(Math.max(16, words.length * 2));
        for (int i = 0; i + WINDOW <= words.length; i++) out.add(hash(words, i));
        return out;
    }

    private static long hash(String[] words, int from) {
        long h = 1125899906842597L;
        for (int i = from; i < from + WINDOW; i++) {
            long w = words[i].hashCode() * 0x9E3779B97F4A7C15L;
            w ^= (w >>> 31) + words[i].length();
            h = 31 * h + w;
        }
        return h;
    }
}
