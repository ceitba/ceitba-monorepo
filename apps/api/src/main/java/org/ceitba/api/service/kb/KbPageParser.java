package org.ceitba.api.service.kb;

import org.ceitba.api.domain.kb.KbPageType;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import org.yaml.snakeyaml.error.YAMLException;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

// Parses one page file (YAML frontmatter + Markdown body) and checks
// everything that does not need the database: frontmatter, slug/type, and
// that every `##` section cites a file. See KbValidator for the rest.
public final class KbPageParser {

    static final int MAX_CONTENT_CHARS = 400_000;

    // Common English slugs the writers produce; pages use Spanish slugs.
    static final java.util.Set<String> ENGLISH_SLUGS = java.util.Set.of(
        "fundamentals", "vouchers", "introduction", "overview", "summary", "basics");
    static final int MAX_CITATION_LABEL = 60;

    // "graph" would collide with GET /v1/wiki/subjects/{id}/kb/graph.
    static final java.util.Set<String> RESERVED = java.util.Set.of("graph");

    private static final Pattern H2 = Pattern.compile("^##(?!#)\\s+(.*)$");

    // Column sizes (kb_page.slug/generator, kb_link.raw/to_slug/to_subject_id):
    // a longer value rejects the page instead of failing the whole import.
    static final int MAX_SLUG = 128;
    static final int MAX_GENERATOR = 128;
    static final int MAX_LINK_RAW = 256;
    static final int MAX_LINK_SUBJECT = 25;

    // Markdown only (defence in depth; the SPA renders with skipHtml too):
    // HTML tags or comments, javascript:/data:/vbscript: links and images
    // loaded from another site are refused. Code is ignored.
    private static final Pattern HTML_TAG = Pattern.compile(
        "<!--|</?(?:a|abbr|b|base|blockquote|body|br|button|canvas|center|code|details|dialog|div|em|embed|font|form"
            + "|frame|frameset|h[1-6]|head|hr|html|i|iframe|img|input|kbd|link|li|marquee|math|meta|noscript|object"
            + "|ol|option|p|picture|pre|s|script|select|small|source|span|strong|style|sub|summary|sup|svg|table"
            + "|tbody|td|template|textarea|th|thead|title|tr|u|ul|video|audio|xmp)(?=[\\s/>])",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern UNSAFE_LINK = Pattern.compile(
        "(?:\\]\\(\\s*<?|^\\s*\\[[^\\]\\n]+]:\\s*<?|<)\\s*(?:javascript|data|vbscript)\\s*:",
        Pattern.CASE_INSENSITIVE | Pattern.MULTILINE);
    private static final Pattern EXTERNAL_IMAGE = Pattern.compile(
        "!\\[[^\\]\\n]*]\\(\\s*<?\\s*(?:[a-z][a-z0-9+.-]*:|//)", Pattern.CASE_INSENSITIVE);

    private KbPageParser() {}

    public record Draft(String slug, KbPageType type, String title, String subject, String summary,
                        List<String> aliases, List<UUID> sources, String generator, OffsetDateTime generatedAt,
                        String body, KbWikilinks.Parsed links) {}

    public record Result(Draft draft, List<String> errors) {
        public boolean ok() { return errors.isEmpty(); }
    }

    // path: "slug.md" (a leading directory is ignored); folderSubjectId: the
    // subject being imported.
    public static Result parse(String path, String content, String folderSubjectId) {
        var errors = new ArrayList<String>();
        var slug = slugOf(path);
        if (slug == null || !KbWikilinks.SLUG.matcher(slug).matches()) {
            errors.add("invalid slug '" + slug + "': lowercase letters, digits and hyphens, file name *.md");
        }
        if (RESERVED.contains(slug)) errors.add("slug '" + slug + "' is reserved");
        if (slug != null && slug.length() > MAX_SLUG) errors.add("slug longer than " + MAX_SLUG + " characters");
        if (content == null || content.isBlank()) {
            errors.add("empty file");
            return new Result(null, errors);
        }
        if (content.length() > MAX_CONTENT_CHARS) {
            errors.add("file too large (max " + MAX_CONTENT_CHARS + " characters)");
            return new Result(null, errors);
        }
        var text = content.replace("\r\n", "\n");
        if (text.startsWith("﻿")) text = text.substring(1);
        if (!text.startsWith("---\n")) {
            errors.add("missing frontmatter (the file must start with ---)");
            return new Result(null, errors);
        }
        int close = text.indexOf("\n---", 3);
        while (close >= 0 && !(close + 4 == text.length() || text.charAt(close + 4) == '\n')) {
            close = text.indexOf("\n---", close + 4);
        }
        if (close < 0) {
            errors.add("frontmatter is not closed with ---");
            return new Result(null, errors);
        }
        var yaml = close >= 4 ? text.substring(4, close) : "";
        var body = close + 4 >= text.length() ? "" : text.substring(close + 5);
        body = body.strip();

        Map<?, ?> fm;
        try {
            var loaded = new Yaml(new SafeConstructor(new LoaderOptions())).load(yaml);
            if (!(loaded instanceof Map<?, ?> map)) {
                errors.add("frontmatter is not a YAML mapping");
                return new Result(null, errors);
            }
            fm = map;
        } catch (YAMLException e) {
            errors.add("invalid frontmatter YAML: " + firstLine(e.getMessage()));
            return new Result(null, errors);
        }

        var title = requiredString(fm, "title", errors);
        var summary = requiredString(fm, "summary", errors);
        var generator = requiredString(fm, "generator", errors);
        if (generator != null && generator.length() > MAX_GENERATOR) {
            errors.add("frontmatter: generator longer than " + MAX_GENERATOR + " characters");
        }

        String subject = null;
        Object rawSubject = fm.get("subject");
        if (rawSubject == null) {
            errors.add("frontmatter: subject is required");
        } else if (!(rawSubject instanceof String s)) {
            errors.add("frontmatter: subject must be a quoted string (e.g. subject: \"61.12\")");
        } else {
            subject = s.trim();
            if (!subject.equals(folderSubjectId)) {
                errors.add("frontmatter: subject '" + subject + "' does not match the folder '" + folderSubjectId + "'");
            }
        }

        KbPageType type = null;
        var rawType = fm.get("type");
        if (rawType == null) {
            errors.add("frontmatter: type is required (index | topic | concept)");
        } else {
            try {
                type = KbPageType.valueOf(String.valueOf(rawType).trim().toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException e) {
                errors.add("frontmatter: type must be index, topic or concept");
            }
        }
        if (type != null && slug != null) {
            if (type == KbPageType.INDEX && !slug.equals("index")) errors.add("type: index is only for index.md");
            if (type != KbPageType.INDEX && slug.equals("index")) errors.add("index.md must have type: index");
        }

        var aliases = new ArrayList<String>();
        var rawAliases = fm.get("aliases");
        if (rawAliases != null) {
            if (rawAliases instanceof Collection<?> list) {
                for (var a : list) {
                    if (a == null || String.valueOf(a).isBlank()) continue;
                    aliases.add(String.valueOf(a).trim());
                }
            } else {
                errors.add("frontmatter: aliases must be a list");
            }
        }

        var sources = new LinkedHashSet<UUID>();
        var rawSources = fm.get("sources");
        if (rawSources == null) {
            errors.add("frontmatter: sources is required (a list of file ids, may be empty)");
        } else if (rawSources instanceof Collection<?> list) {
            for (var s : list) {
                try {
                    sources.add(UUID.fromString(String.valueOf(s).trim()));
                } catch (IllegalArgumentException e) {
                    errors.add("frontmatter: source '" + s + "' is not a file id");
                }
            }
        } else {
            errors.add("frontmatter: sources must be a list");
        }

        OffsetDateTime generatedAt = null;
        var rawDate = fm.get("generated_at");
        if (rawDate == null) {
            errors.add("frontmatter: generated_at is required");
        } else if (rawDate instanceof Date d) {
            generatedAt = d.toInstant().atOffset(ZoneOffset.UTC);
        } else {
            var s = String.valueOf(rawDate).trim();
            try {
                generatedAt = s.length() == 10 ? LocalDate.parse(s).atStartOfDay().atOffset(ZoneOffset.UTC)
                    : OffsetDateTime.parse(s);
            } catch (DateTimeParseException e) {
                errors.add("frontmatter: generated_at must be a date (YYYY-MM-DD)");
            }
        }

        if (body.isBlank()) errors.add("empty page body");
        for (var section : sectionsWithoutCitation(body)) {
            errors.add("section '" + section + "' has no [[file:…]] citation");
        }
        errors.addAll(citationFormatErrors(body));
        if (slug != null && ENGLISH_SLUGS.contains(slug)) errors.add("slug must be Spanish ('" + slug + "')");
        var links = KbWikilinks.parse(body, folderSubjectId, slug);
        for (var c : links.citations()) {
            if (c.id() == null) errors.add("invalid citation [[" + c.raw() + "]]");
        }
        for (var l : links.links()) {
            if (l.raw().length() > MAX_LINK_RAW || l.slug().length() > MAX_SLUG
                    || l.subjectId().length() > MAX_LINK_SUBJECT) {
                errors.add("link too long: [[" + preview(l.raw()) + "...]]");
            }
        }
        errors.addAll(unsafeMarkdownErrors(body));
        errors.addAll(KbStyleChecks.latexErrors(body));
        errors.addAll(KbStyleChecks.metaSectionErrors(body));
        errors.addAll(KbStyleChecks.selfLinkErrors(links, folderSubjectId, slug));

        if (!errors.isEmpty()) return new Result(null, errors);
        return new Result(new Draft(slug, type, title, subject, summary, List.copyOf(aliases), List.copyOf(sources),
            generator, generatedAt, body, links), errors);
    }

    // Citations are short references at the end of a sentence, never wrapping
    // content (port of scripts/kb/validate_kb.py): closed on the same line,
    // label <= 60 characters, no math in the label.
    static List<String> citationFormatErrors(String body) {
        var out = new ArrayList<String>();
        var text = KbWikilinks.stripCode(body);
        int from = 0;
        while (true) {
            int at = text.indexOf("[[file:", from);
            if (at < 0) break;
            int end = text.indexOf("]]", at);
            var seg = text.substring(at, end < 0 ? text.length() : end);
            if (seg.length() > 7 && Character.isWhitespace(seg.charAt(7))) {
                out.add("citation format: no space allowed after 'file:'; write [[file:<id>|short name]], with the "
                    + "id of one of the page's sources right after the colon: " + preview(seg));
            } else if (end < 0 || seg.contains("\n")) {
                out.add("citation not closed on the same line: " + preview(seg) + "...");
            } else {
                int bar = seg.indexOf('|');
                if (bar >= 0 && (seg.length() - bar - 1 > MAX_CITATION_LABEL || seg.contains("$"))) {
                    out.add("citation label must be a short file name (<= " + MAX_CITATION_LABEL
                        + " chars, no math): " + preview(seg));
                }
            }
            from = at + 7;
        }
        return out;
    }

    // Raw HTML, script/data links and remote images (outside code and math,
    // where "a<b y" is not a tag).
    static List<String> unsafeMarkdownErrors(String body) {
        var out = new ArrayList<String>();
        var text = KbWikilinks.stripCode(body).replaceAll("(?s)\\$\\$.*?\\$\\$", " ")
            .replaceAll("\\$[^$\\n]+\\$", " ");
        var m = HTML_TAG.matcher(text);
        if (m.find()) out.add("raw HTML is not allowed (" + preview(text.substring(m.start())) + ")");
        if (UNSAFE_LINK.matcher(text).find()) out.add("javascript:, data: and vbscript: links are not allowed");
        if (EXTERNAL_IMAGE.matcher(text).find()) out.add("images from other sites are not allowed");
        return out;
    }

    private static String preview(String s) {
        var p = s.replace('\n', ' ');
        return p.length() <= 70 ? p : p.substring(0, 70);
    }

    // Headings of `##` sections (up to the next `##`, ### included) without a
    // [[file:...]] citation. Code blocks are not headings.
    public static int sectionsWithoutCitationCount(String body) {
        return sectionsWithoutCitation(body).size();
    }

    static List<String> sectionsWithoutCitation(String body) {
        var out = new ArrayList<String>();
        String heading = null;
        boolean cited = false;
        for (var line : KbWikilinks.stripCode(body).split("\n", -1)) {
            var m = H2.matcher(line);
            if (m.matches()) {
                if (heading != null && !cited) out.add(heading);
                heading = m.group(1).trim();
                cited = false;
            }
            if (line.contains("[[file:")) cited = true;
        }
        if (heading != null && !cited) out.add(heading);
        return out;
    }

    static String slugOf(String path) {
        if (path == null) return null;
        var name = path.substring(path.lastIndexOf('/') + 1);
        return name.endsWith(".md") ? name.substring(0, name.length() - 3) : name;
    }

    private static String requiredString(Map<?, ?> fm, String key, List<String> errors) {
        var v = fm.get(key);
        if (v == null || String.valueOf(v).isBlank()) {
            errors.add("frontmatter: " + key + " is required");
            return null;
        }
        if (v instanceof Map<?, ?> || v instanceof Collection<?>) {
            errors.add("frontmatter: " + key + " must be text");
            return null;
        }
        return String.valueOf(v).trim();
    }

    private static String firstLine(String s) {
        if (s == null) return "";
        int nl = s.indexOf('\n');
        return nl < 0 ? s : s.substring(0, nl);
    }
}
