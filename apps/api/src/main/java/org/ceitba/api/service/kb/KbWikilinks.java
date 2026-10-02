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
// Links inside fenced code blocks and inline code are ignored.
public final class KbWikilinks {

    public static final Pattern SLUG = Pattern.compile("^[a-z0-9]+(-[a-z0-9]+)*$");
    // Subject ids are codes like "61.12" (letters allowed after the digits).
    static final Pattern SUBJECT_ID = Pattern.compile("^[0-9]{1,3}(\\.[0-9A-Za-z]{1,4})+$");

    private static final Pattern LINK = Pattern.compile("\\[\\[([^\\[\\]|\\n]+?)(?:\\|([^\\[\\]\\n]*))?]]");
    private static final Pattern FENCE = Pattern.compile("(?ms)^(```|~~~).*?(^\\1[ \\t]*$|\\z)");
    private static final Pattern INLINE_CODE = Pattern.compile("`[^`\\n]*`");

    private KbWikilinks() {}

    // A link to a page: raw = the inner text before '|' (trimmed).
    public record PageLink(String raw, String subjectId, String slug) {}

    // A [[file:...]] citation; id is null when it is not a UUID.
    public record Citation(String raw, UUID id) {}

    public record Parsed(List<PageLink> links, List<Citation> citations) {}

    public static Parsed parse(String body, String currentSubjectId) {
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
            links.computeIfAbsent(raw, r -> target(r, currentSubjectId));
        }
        return new Parsed(List.copyOf(links.values()), List.copyOf(citations));
    }

    static PageLink target(String raw, String currentSubjectId) {
        int slash = raw.indexOf('/');
        if (slash > 0) return new PageLink(raw, raw.substring(0, slash).trim(), raw.substring(slash + 1).trim());
        if (SUBJECT_ID.matcher(raw).matches()) return new PageLink(raw, raw, "index");
        return new PageLink(raw, currentSubjectId, raw);
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
