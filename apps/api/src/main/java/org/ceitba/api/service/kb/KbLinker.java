package org.ceitba.api.service.kb;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Deterministic linker (port of scripts/kb/link_kb.py). Rule: a key concept
// that has its own page in the subject is never mentioned without a link to
// it. In every `##` section of a page (and the intro before the first one),
// the first plain-text mention of another page of the same subject (its
// title or an alias) becomes [[slug|mention]], unless the section already
// links to that page. Headings, code, math, existing links and Markdown
// links are never touched. Cross-subject mentions are left alone (string
// matching across subjects produces false friends).
//
// link() rewrites a body; unlinked() lists what link() would add (the
// import/pipeline coverage check: "no unlinked mention of a same-subject page").
public final class KbLinker {

    private static final Pattern PROTECT = Pattern.compile(
        "(\\$\\$.*?\\$\\$|\\$[^$\\n]+\\$|`[^`]*`|\\[\\[[^\\]]*\\]\\]|\\[[^\\]]*\\]\\([^)]*\\))", Pattern.DOTALL);
    private static final Pattern WIKILINK = Pattern.compile("\\[\\[([^\\]]+)\\]\\]");
    private static final Pattern WORD = Pattern.compile("[\\p{L}\\p{N}_]+");
    private static final Pattern SYMBOLS = Pattern.compile("[=+$()]");
    private static final Set<String> STOP = Set.of(
        "de", "del", "la", "el", "los", "las", "y", "e", "en", "a", "por", "para", "con", "un", "una", "o");

    private KbLinker() {}

    // A page of the subject as the linker sees it.
    public record Target(String slug, String title, List<String> aliases) {}

    public record Mention(String slug, String text) {}

    public record Result(String body, List<String> addedSlugs) {}

    public static Result link(String body, String currentSlug, List<Target> pages) {
        return run(body, currentSlug, pages, false, new ArrayList<>());
    }

    public static List<Mention> unlinked(String body, String currentSlug, List<Target> pages) {
        var out = new ArrayList<Mention>();
        run(body, currentSlug, pages, true, out);
        return out;
    }

    private static Result run(String body, String currentSlug, List<Target> pages, boolean check, List<Mention> found) {
        var lines = new ArrayList<>(List.of(body.split("\n", -1)));
        var sections = new ArrayList<List<Integer>>();
        var cur = new ArrayList<Integer>();
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).startsWith("## ") && !cur.isEmpty()) {
                sections.add(cur);
                cur = new ArrayList<>();
            }
            cur.add(i);
        }
        sections.add(cur);
        boolean inFence = false;
        var fenced = new boolean[lines.size()];
        for (int i = 0; i < lines.size(); i++) {
            var t = lines.get(i).trim();
            if (t.startsWith("```") || t.startsWith("~~~")) {
                fenced[i] = true;
                inFence = !inFence;
            } else {
                fenced[i] = inFence;
            }
        }

        var targets = pages.stream()
            .filter(p -> p.slug() != null && !p.slug().equals(currentSlug) && !p.slug().equals("index"))
            .sorted(Comparator.comparing(Target::slug))
            .toList();
        var added = new ArrayList<String>();
        for (var idxs : sections) {
            var linked = new LinkedHashSet<String>();
            for (var i : idxs) {
                Matcher m = WIKILINK.matcher(lines.get(i));
                while (m.find()) linked.add(m.group(1).split("\\|", 2)[0].split("#", 2)[0].trim());
            }
            for (var t : targets) {
                var ts = terms(t);
                if (linked.contains(t.slug()) || ts.isEmpty()) continue;
                for (var i : idxs) {
                    var line = lines.get(i);
                    if (fenced[i] || line.startsWith("#") || line.startsWith("---")) continue;
                    var replaced = replaceFirst(line, ts, t.slug(), check, found);
                    if (replaced != null) {
                        if (!check) {
                            lines.set(i, replaced);
                            added.add(t.slug());
                        }
                        linked.add(t.slug());
                        break;
                    }
                }
            }
        }
        return new Result(String.join("\n", lines), added);
    }

    // The line with its first mention of one of `terms` linked, or null.
    private static String replaceFirst(String line, List<String> terms, String slug, boolean check,
                                       List<Mention> found) {
        var m = PROTECT.matcher(line);
        int last = 0;
        var segments = new ArrayList<int[]>();   // plain-text ranges
        while (m.find()) {
            segments.add(new int[]{last, m.start()});
            last = m.end();
        }
        segments.add(new int[]{last, line.length()});
        var folded = fold(line);
        for (var seg : segments) {
            var plain = folded.substring(seg[0], seg[1]);
            for (var term : terms) {
                int at = find(plain, fold(term));
                if (at < 0) continue;
                int start = seg[0] + at;
                int end = start + term.length();
                var original = line.substring(start, end);
                if (check) {
                    found.add(new Mention(slug, original));
                    return line;
                }
                return line.substring(0, start) + "[[" + slug + "|" + original + "]]" + line.substring(end);
            }
        }
        return null;
    }

    // Whole-word occurrence of `term` in `text` (both folded).
    private static int find(String text, String term) {
        int from = 0;
        while (true) {
            int at = text.indexOf(term, from);
            if (at < 0) return -1;
            boolean before = at == 0 || !isWord(text.charAt(at - 1));
            int end = at + term.length();
            boolean after = end >= text.length() || !isWord(text.charAt(end));
            if (before && after) return at;
            from = at + 1;
        }
    }

    private static boolean isWord(char c) {
        return Character.isLetterOrDigit(c) || c == '_';
    }

    // Titles/aliases worth linking, longest first: 2+ content words, or one
    // content word of 4+ letters (title) / 6+ (alias); nothing with symbols.
    static List<String> terms(Target page) {
        var all = new ArrayList<String>();
        all.add(page.title());
        if (page.aliases() != null) all.addAll(page.aliases());
        var out = new LinkedHashSet<String>();
        for (int i = 0; i < all.size(); i++) {
            var t = all.get(i) == null ? "" : all.get(i).strip();
            if (t.isEmpty() || SYMBOLS.matcher(t).find()) continue;
            var words = contentWords(t);
            int min = i == 0 ? 4 : 6;
            if (words.size() >= 2 || (words.size() == 1 && words.get(0).length() >= min)) out.add(t);
        }
        return out.stream().sorted(Comparator.comparingInt(String::length).reversed()).toList();
    }

    private static List<String> contentWords(String t) {
        var out = new ArrayList<String>();
        var m = WORD.matcher(fold(t));
        while (m.find()) if (!STOP.contains(m.group())) out.add(m.group());
        return out;
    }

    // Lowercase without accents, same length as the input (char by char), so
    // positions in the folded text are positions in the original.
    static String fold(String s) {
        var sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            var n = Normalizer.normalize(String.valueOf(c), Normalizer.Form.NFD);
            char base = n.isEmpty() ? c : n.charAt(0);
            sb.append(Character.toLowerCase(base));
        }
        return sb.toString();
    }
}
