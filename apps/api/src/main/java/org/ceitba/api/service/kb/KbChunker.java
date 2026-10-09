package org.ceitba.api.service.kb;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

// Cuts a wiki page into the chunks that get embedded (docs/SUBJECT-WIKI.md
// "Embeddings"): chunk 0 = title, summary and the text before the first ##
// heading; then one chunk per ## section, its ### subsections included.
// Sections longer than MAX_CHARS are split at blank lines (or hard-cut when a
// single paragraph is longer). Every chunk carries a title (the page title, plus
// its heading), so it still says what it is about out of context; the embedding
// service puts title and body into the model's document prompt. Wikilinks become
// their text ([[slug|text]] -> text, [[slug]] -> slug); bare citations
// ([[file:<uuid>]]) are dropped. Headings inside code fences don't split.
public final class KbChunker {

    // ~1.5k tokens of Spanish prose: well inside the embedding model's input
    // window, small enough that one chunk is about one thing.
    public static final int MAX_CHARS = 6000;

    private static final Pattern H2 = Pattern.compile("^##(?!#)\\s+(.*?)\\s*#*\\s*$");
    private static final Pattern LINK_WITH_TEXT = Pattern.compile("\\[\\[[^\\[\\]|\\n]+\\|([^\\[\\]\\n]*)]]");
    private static final Pattern BARE_CITATION = Pattern.compile("\\[\\[\\s*file:[^\\[\\]\\n]*]]");
    private static final Pattern BARE_LINK = Pattern.compile("\\[\\[([^\\[\\]\\n]+)]]");

    private KbChunker() {}

    // heading/anchor are null for chunk 0. title = "Page" (chunk 0) or
    // "Page — Heading"; body = chunk 0's summary and intro, or the section text.
    public record Chunk(int ordinal, String heading, String anchor, String title, String body) {

        // What is stored (kb_page_chunk.content) and shown for a hit.
        public String text() {
            return body.isEmpty() ? title : title + "\n\n" + body;
        }
    }

    public static List<Chunk> chunk(String title, String summary, String markdown) {
        var lines = markdown.split("\n", -1);
        // Same line structure, code blanked out: headings are looked for here.
        var plain = KbWikilinks.stripCode(markdown).split("\n", -1);

        var chunks = new ArrayList<Chunk>();
        String heading = null;
        var section = new StringBuilder();
        for (int i = 0; i < lines.length; i++) {
            var m = i < plain.length ? H2.matcher(plain[i]) : null;
            if (m != null && m.matches()) {
                add(chunks, title, summary, heading, section.toString());
                heading = linkText(m.group(1)).trim();
                section.setLength(0);
                continue;
            }
            section.append(lines[i]).append('\n');
        }
        add(chunks, title, summary, heading, section.toString());
        return List.copyOf(chunks);
    }

    private static void add(List<Chunk> out, String title, String summary, String heading, String body) {
        var text = linkText(body).replaceAll("[ \\t]+\\n", "\n").replaceAll("\\n{3,}", "\n\n").strip();
        // Chunk 0 always exists (title and summary alone are worth a vector);
        // an empty ## section adds nothing.
        if (heading != null && text.isEmpty()) return;
        var chunkTitle = heading == null ? title : title + " — " + heading;
        if (heading == null) text = text.isEmpty() ? summary : summary + "\n\n" + text;
        var anchor = heading == null ? null : KbWikilinks.anchor(heading);
        for (var part : split(text, MAX_CHARS - chunkTitle.length() - 2)) {
            out.add(new Chunk(out.size(), heading, anchor, chunkTitle, part));
        }
    }

    // Wikilinks reduced to their text; bare citations dropped.
    static String linkText(String s) {
        var t = LINK_WITH_TEXT.matcher(s).replaceAll(r -> java.util.regex.Matcher.quoteReplacement(r.group(1)));
        t = BARE_CITATION.matcher(t).replaceAll("");
        return BARE_LINK.matcher(t).replaceAll(r -> java.util.regex.Matcher.quoteReplacement(r.group(1).trim()));
    }

    // Greedy packing of paragraphs into parts of at most max chars.
    static List<String> split(String text, int max) {
        if (text.length() <= max) return List.of(text);
        var parts = new ArrayList<String>();
        var cur = new StringBuilder();
        for (var para : text.split("\\n\\n")) {
            while (para.length() > max) {
                if (!cur.isEmpty()) {
                    parts.add(cur.toString());
                    cur.setLength(0);
                }
                parts.add(para.substring(0, max));
                para = para.substring(max);
            }
            if (!cur.isEmpty() && cur.length() + 2 + para.length() > max) {
                parts.add(cur.toString());
                cur.setLength(0);
            }
            if (!cur.isEmpty()) cur.append("\n\n");
            cur.append(para);
        }
        if (!cur.isEmpty()) parts.add(cur.toString());
        return parts;
    }
}
