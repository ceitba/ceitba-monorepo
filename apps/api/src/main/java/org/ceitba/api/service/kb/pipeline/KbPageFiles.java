package org.ceitba.api.service.kb.pipeline;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.kb.KbPage;
import org.ceitba.api.domain.kb.KbPageType;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

// Page files (frontmatter + Markdown) as the pipeline handles them: the
// current page rebuilt from the database, and an LLM draft normalized so
// the system owns subject/type/sources/generator/generated_at.
public final class KbPageFiles {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern CITATION = Pattern.compile("\\[\\[file:([0-9a-fA-F-]{36})");

    private KbPageFiles() {}

    public record Parts(Map<?, ?> frontmatter, String body) {}

    public static String of(KbPage p) {
        return file(p.getTitle(), p.getSubjectId(), p.getType().wire(), p.getSummary(), p.getAliases(),
            p.getSources().stream().map(Object::toString).toList(), p.getGenerator(),
            p.getGeneratedAt().toLocalDate(), p.getMarkdown());
    }

    public static String file(String title, String subjectId, String type, String summary, Collection<String> aliases,
                              Collection<String> sources, String generator, LocalDate generatedAt, String body) {
        return "---\n"
            + "title: " + q(title) + "\n"
            + "subject: " + q(subjectId) + "\n"
            + "type: " + type + "\n"
            + "summary: " + q(summary) + "\n"
            + "aliases: " + list(aliases) + "\n"
            + "sources: " + list(sources) + "\n"
            + "generator: " + q(generator) + "\n"
            + "generated_at: " + generatedAt + "\n"
            + "---\n\n" + body.strip() + "\n";
    }

    // Splits a file; frontmatter null when it has none or it is not a mapping.
    public static Parts split(String content) {
        var text = content == null ? "" : content.replace("\r\n", "\n").strip();
        if (text.startsWith("```")) {   // a fenced answer
            text = text.replaceFirst("^```[a-zA-Z]*\\n", "").replaceFirst("\\n```\\s*$", "").strip();
        }
        if (!text.startsWith("---\n")) return new Parts(null, text);
        int close = text.indexOf("\n---", 3);
        if (close < 0) return new Parts(null, text);
        Map<?, ?> fm = null;
        try {
            var loaded = new Yaml(new SafeConstructor(new LoaderOptions())).load(text.substring(4, close));
            if (loaded instanceof Map<?, ?> m) fm = m;
        } catch (RuntimeException ignored) {
            // invalid YAML: normalized from the operation below
        }
        var body = close + 4 >= text.length() ? "" : text.substring(close + 4);
        return new Parts(fm, body.strip());
    }

    // The draft with a frontmatter the system controls: subject/type/slug from
    // the operation, sources = the files cited in the body, our generator/date.
    public static String normalize(String draft, String subjectId, KbPageType type, String fallbackTitle,
                                   String generator, LocalDate today) {
        var parts = split(draft);
        var fm = parts.frontmatter() == null ? Map.of() : parts.frontmatter();
        var title = str(fm.get("title"), fallbackTitle);
        var summary = str(fm.get("summary"), title + ".");
        var aliases = new ArrayList<String>();
        if (fm.get("aliases") instanceof Collection<?> c) {
            for (var a : c) if (a != null && !String.valueOf(a).isBlank()) aliases.add(String.valueOf(a).trim());
        }
        return file(title, subjectId, type.wire(), summary, aliases, citedIds(parts.body()), generator, today,
            parts.body());
    }

    // The same file with another body (frontmatter kept as is).
    public static String replaceBody(String file, String body) {
        int close = file.indexOf("\n---", 3);
        if (!file.startsWith("---\n") || close < 0) return body;
        return file.substring(0, close + 4) + "\n\n" + body.strip() + "\n";
    }

    public static List<String> citedIds(String body) {
        var out = new LinkedHashSet<String>();
        var m = CITATION.matcher(body);
        while (m.find()) out.add(m.group(1).toLowerCase());
        return List.copyOf(out);
    }

    private static String str(Object o, String fallback) {
        if (o == null) return fallback;
        var s = String.valueOf(o).strip();
        return s.isEmpty() ? fallback : s;
    }

    // JSON strings and arrays are valid YAML.
    private static String q(String s) {
        try {
            return JSON.writeValueAsString(s == null ? "" : s);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String list(Collection<String> values) {
        try {
            return JSON.writeValueAsString(values == null ? List.of() : values);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
