package org.ceitba.api.service.kb;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

// Wikilinks of a page body (docs/SUBJECT-WIKI.md):
//   [[slug]] / [[slug|text]]                  page in the same subject
//   [[61.12/slug]] / [[61.12/slug|text]]      page in another subject
//   [[61.12]] / [[61.12|text]]                another subject's index
//   [[file:<uuid>]] / [[file:<uuid>|text]]    citation of a source file
// Page links may end in #anchor ([[slug#a]], [[61.12/slug#a]], [[#a]] for
// the same page); the anchor is a folded `##`-`####` heading (anchor()).
// Links inside fenced code blocks and inline code are ignored.
public final class KbWikilinks {

    public static final Pattern SLUG = Pattern.compile("^[a-z0-9]+(-[a-z0-9]+)*$");
    // Subject ids are codes like "61.12" (letters allowed after the digits).
    static final Pattern SUBJECT_ID = Pattern.compile("^[0-9]{1,3}(\\.[0-9A-Za-z]{1,4})+$");

    private static final Pattern LINK = Pattern.compile("\\[\\[([^\\[\\]|\\n]+?)(?:\\|([^\\[\\]\\n]*))?]]");
    private static final Pattern FENCE = Pattern.compile("(?ms)^(```|~~~).*?(^\\1[ \\t]*$|\\z)");
    private static final Pattern INLINE_CODE = Pattern.compile("`[^`\\n]*`");

    private KbWikilinks() {}

    // A link to a page: raw = the inner text before '|' (trimmed), anchor
    // included; anchor = the folded #anchor or null.
    public record PageLink(String raw, String subjectId, String slug, String anchor) {}

    private static final Pattern HEADING = Pattern.compile("^#{2,4}(?!#)\\s+(.*?)\\s*#*\\s*$");

    // A [[file:...]] citation; id is null when it is not a UUID.
    public record Citation(String raw, UUID id) {}

    public record Parsed(List<PageLink> links, List<Citation> citations) {}

    public static Parsed parse(String body, String currentSubjectId) {
        return parse(body, currentSubjectId, null);
    }

    // currentSlug: target of same-page links ([[#anchor]]).
    public static Parsed parse(String body, String currentSubjectId, String currentSlug) {
        var text = stripCode(body);
        var links = new LinkedHashMap<String, PageLink>();
        var citations = new ArrayList<Citation>();
        var m = LINK.matcher(text);
        while (m.find()) {
            var raw = m.group(1).trim();
            if (raw.isEmpty()) continue;
            if (raw.startsWith("file:")) {
                citations.add(new Citation(raw, uuid(raw.substring(5).trim())));
                continue;
            }
            links.computeIfAbsent(raw, r -> target(r, currentSubjectId, currentSlug));
        }
        return new Parsed(List.copyOf(links.values()), List.copyOf(citations));
    }

    public static PageLink target(String raw, String currentSubjectId, String currentSlug) {
        String anchor = null;
        var target = raw;
        int hash = raw.indexOf('#');
        if (hash >= 0) {
            anchor = anchor(raw.substring(hash + 1));
            if (anchor.isEmpty()) anchor = null;
            target = raw.substring(0, hash).trim();
        }
        if (target.isEmpty()) {
            return new PageLink(raw, currentSubjectId, currentSlug == null ? "index" : currentSlug, anchor);
        }
        int slash = target.indexOf('/');
        if (slash > 0) {
            return new PageLink(raw, target.substring(0, slash).trim(), target.substring(slash + 1).trim(), anchor);
        }
        if (SUBJECT_ID.matcher(target).matches()) return new PageLink(raw, target, "index", anchor);
        return new PageLink(raw, currentSubjectId, target, anchor);
    }

    // "Cómo se calcula" -> "como-se-calcula": lowercase, accents removed,
    // runs of anything but [a-z0-9] -> '-', trimmed of '-'.
    public static String anchor(String text) {
        var n = java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
        return n.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
    }

    // Anchors of a body's ## to #### headings (wikilinks in them count by text).
    public static java.util.Set<String> headingAnchors(String body) {
        var out = new java.util.LinkedHashSet<String>();
        for (var line : stripCode(body).split("\n", -1)) {
            var m = HEADING.matcher(line);
            if (!m.matches()) continue;
            out.add(headingAnchor(m.group(1)));
        }
        return out;
    }

    // The anchor of a heading's text (wikilinks in it count by their text).
    public static String headingAnchor(String headingText) {
        return anchor(headingText.replaceAll("\\[\\[[^\\[\\]|\\n]+\\|([^\\[\\]\\n]*)]]", "$1")
            .replaceAll("\\[\\[([^\\[\\]\\n]+)]]", "$1"));
    }

    // Body with code blocks/spans blanked out (line structure kept).
    public static String stripCode(String body) {
        var noFences = FENCE.matcher(body).replaceAll(r -> r.group().replaceAll("[^\\n]", " "));
        return INLINE_CODE.matcher(noFences).replaceAll(r -> " ".repeat(r.group().length()));
    }

    private static UUID uuid(String s) {
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
