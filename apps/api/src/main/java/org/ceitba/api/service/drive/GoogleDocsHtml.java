package org.ceitba.api.service.drive;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Element;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Turns the HTML of a Google Docs export into plain semantic HTML BEFORE
// DocHtmlSanitizer strips every class and style. The export expresses almost
// everything through classes defined in its <style>:
//
//   formatting  .c3{font-weight:700} / font-style:italic / text-decoration:
//               underline|line-through / vertical-align:super|sub
//               -> <strong> <em> <u> <s> <sup> <sub> inside the element
//   alignment   text-align:center|right -> data-align="center|right"
//   lists       one flat <ul>/<ol> per run of items; the nesting level is the
//               N of class lst-kix_<id>-<N>, the marker comes from
//               .lst-kix_<id>-<N>>li:before{content:counter(..,lower-latin)}
//               or list-style-type -> real nested lists (a level-N list goes
//               into the last <li> of the nearest preceding level N-1 list;
//               consecutive runs of the same list and level are merged),
//               <ol type="1|a|A|i|I">, and `start` set when a numbered list
//               continues after an interruption (no "start" class)
//   indents     a paragraph (outside lists) with margin-left >= 36pt
//               -> <blockquote>
//
// Current exports also (or only) put formatting in inline style attributes;
// both are read. Google's CSS is flat (one class per selector), so a small regex parser is
// enough. Anything not understood is left as is.
public final class GoogleDocsHtml {

    private static final Pattern RULE = Pattern.compile("([^{}]+)\\{([^{}]*)}");
    private static final Pattern IMPORT = Pattern.compile("@import[^;]*;");
    private static final Pattern CLASS_SELECTOR = Pattern.compile("^(?:[a-z0-9]+)?\\.([A-Za-z0-9_-]+)$");
    private static final Pattern LIST_CLASS = Pattern.compile("^lst-kix_(.+)-(\\d+)$");
    private static final Pattern LIST_BEFORE = Pattern.compile("^\\.(lst-kix_.+-\\d+)\\s*>\\s*li:before$");
    private static final Pattern LIST_SELECTOR = Pattern.compile("^(?:ol|ul)?\\.(lst-kix_.+-\\d+)$");
    private static final Pattern COUNTER_STYLE = Pattern.compile("counter\\([^,)]+,\\s*([a-z-]+)\\s*\\)");
    private static final Pattern PT = Pattern.compile("^(-?[0-9.]+)pt$");

    private GoogleDocsHtml() {}

    public static String normalize(String html) {
        if (html == null || html.isBlank()) return html;
        var doc = Jsoup.parse(html);
        var css = new StringBuilder();
        for (var style : doc.select("style")) css.append(style.data()).append('\n');
        var rules = parseCss(css.toString());
        var classes = classDeclarations(rules);
        var listTypes = listTypes(rules);

        for (var el : doc.body().select("[class], [style]")) {
            var decls = declarationsOf(el, classes);
            if (decls.isEmpty()) continue;
            align(el, decls);
            format(el, decls);
        }
        for (var container : doc.body().select("body, td, th, li")) nestLists(container, listTypes);
        indent(doc.body(), classes);
        return doc.outerHtml();
    }

    // ---- CSS -------------------------------------------------------------------

    // selector -> declarations (property -> value, lowercase), in order.
    static Map<String, Map<String, String>> parseCss(String css) {
        Map<String, Map<String, String>> out = new LinkedHashMap<>();
        Matcher m = RULE.matcher(IMPORT.matcher(css).replaceAll(""));
        while (m.find()) {
            var decls = new LinkedHashMap<String, String>();
            for (var d : m.group(2).split(";")) {
                int colon = d.indexOf(':');
                if (colon <= 0) continue;
                decls.put(d.substring(0, colon).trim().toLowerCase(Locale.ROOT), d.substring(colon + 1).trim());
            }
            for (var selector : m.group(1).split(",")) {
                out.computeIfAbsent(selector.trim(), k -> new LinkedHashMap<>()).putAll(decls);
            }
        }
        return out;
    }

    private static Map<String, Map<String, String>> classDeclarations(Map<String, Map<String, String>> rules) {
        Map<String, Map<String, String>> out = new HashMap<>();
        rules.forEach((selector, decls) -> {
            var m = CLASS_SELECTOR.matcher(selector);
            if (m.matches()) out.computeIfAbsent(m.group(1), k -> new LinkedHashMap<>()).putAll(decls);
        });
        return out;
    }

    // list class (lst-kix_<id>-<N>) -> CSS list style (decimal, lower-latin, disc...).
    private static Map<String, String> listTypes(Map<String, Map<String, String>> rules) {
        Map<String, String> out = new HashMap<>();
        rules.forEach((selector, decls) -> {
            var before = LIST_BEFORE.matcher(selector);
            if (before.matches()) {
                var content = decls.getOrDefault("content", "");
                var counter = COUNTER_STYLE.matcher(content);
                if (counter.find()) out.put(before.group(1), counter.group(1));
                return;
            }
            var list = LIST_SELECTOR.matcher(selector);
            var type = decls.get("list-style-type");
            if (list.matches() && type != null && !type.equals("none")) out.putIfAbsent(list.group(1), type);
        });
        return out;
    }

    // Class rules, then the inline style (current exports put formatting
    // inline: style="font-weight:700;text-decoration:underline").
    private static Map<String, String> declarationsOf(Element el, Map<String, Map<String, String>> classes) {
        Map<String, String> out = new HashMap<>();
        for (var c : el.classNames()) {
            var decls = classes.get(c);
            if (decls != null) out.putAll(decls);
        }
        if (el.hasAttr("style")) {
            for (var d : el.attr("style").split(";")) {
                int colon = d.indexOf(':');
                if (colon > 0) out.put(d.substring(0, colon).trim().toLowerCase(Locale.ROOT), d.substring(colon + 1).trim());
            }
        }
        return out;
    }

    // ---- inline formatting and alignment -----------------------------------

    private static void format(Element el, Map<String, String> decls) {
        var tag = el.normalName();
        if (!(tag.equals("span") || tag.equals("p") || tag.equals("li") || tag.equals("td") || tag.equals("th"))) return;
        if (!el.hasText() && el.select("img").isEmpty()) return;
        boolean inHeading = el.normalName().matches("h[1-6]") || hasAncestor(el, "h1|h2|h3|h4|h5|h6");
        boolean inLink = hasAncestor(el, "a") || !el.select("a").isEmpty();

        var weight = decls.getOrDefault("font-weight", "");
        boolean bold = !inHeading && (weight.equals("bold") || weight.equals("bolder") || numeric(weight) >= 600);
        boolean italic = decls.getOrDefault("font-style", "").contains("italic");
        var decoration = decls.getOrDefault("text-decoration", "") + " " + decls.getOrDefault("text-decoration-line", "");
        boolean underline = !inLink && decoration.contains("underline");
        boolean strike = decoration.contains("line-through");
        var valign = decls.getOrDefault("vertical-align", "");

        // Innermost first, so the result reads <strong><em>...</em></strong>.
        if (valign.equals("super")) wrapContents(el, "sup");
        if (valign.equals("sub")) wrapContents(el, "sub");
        if (strike) wrapContents(el, "s");
        if (underline) wrapContents(el, "u");
        if (italic) wrapContents(el, "em");
        if (bold) wrapContents(el, "strong");
    }

    private static void align(Element el, Map<String, String> decls) {
        var a = decls.getOrDefault("text-align", "");
        if (!(a.equals("center") || a.equals("right"))) return;
        if (el.normalName().matches("p|h[1-6]|li|td|th|div")) el.attr("data-align", a);
    }

    private static boolean hasAncestor(Element el, String tagRegex) {
        for (var p = el.parent(); p != null; p = p.parent()) {
            if (p.normalName().matches(tagRegex)) return true;
        }
        return false;
    }

    private static void wrapContents(Element el, String tag) {
        var wrapper = new Element(tag);
        for (var node : new ArrayList<>(el.childNodes())) wrapper.appendChild(node);
        el.appendChild(wrapper);
    }

    private static double numeric(String s) {
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    // ---- lists -------------------------------------------------------------------

    private record ListInfo(String id, int level, String listClass) {}

    private static ListInfo listInfo(Element el) {
        if (!(el.normalName().equals("ul") || el.normalName().equals("ol"))) return null;
        for (var c : el.classNames()) {
            var m = LIST_CLASS.matcher(c);
            if (m.matches()) return new ListInfo(m.group(1), Integer.parseInt(m.group(2)), c);
        }
        return null;
    }

    private record Open(ListInfo info, Element list) {}

    // Rebuilds nesting among the direct children of `container`.
    private static void nestLists(Element container, Map<String, String> listTypes) {
        var stack = new ArrayDeque<Open>();
        Map<String, Integer> counts = new HashMap<>();   // items seen per list class (numbering)
        for (var child : new ArrayList<>(container.children())) {
            if (child.parent() != container) continue;   // already moved
            var info = listInfo(child);
            if (info == null) {
                stack.clear();
                continue;
            }
            boolean ordered = child.normalName().equals("ol");
            var cssType = listTypes.get(info.listClass());
            if (ordered) {
                var type = olType(cssType);
                if (type != null) child.attr("type", type);
            }
            if (child.hasClass("start")) counts.put(info.listClass(), 0);

            while (!stack.isEmpty() && stack.peek().info().level() > info.level()) stack.pop();
            var top = stack.peek();
            if (top != null && top.info().level() == info.level()) {
                if (top.info().id().equals(info.id()) && top.list().normalName().equals(child.normalName())) {
                    var target = top.list();
                    var items = child.children().stream().filter(c -> c.normalName().equals("li")).toList();
                    items.forEach(target::appendChild);
                    counts.merge(info.listClass(), items.size(), Integer::sum);
                    child.remove();
                    continue;
                }
                stack.pop();
                top = stack.peek();
            }
            if (ordered && !child.hasAttr("start")) {
                int seen = counts.getOrDefault(info.listClass(), 0);
                if (seen > 0) child.attr("start", String.valueOf(seen + 1));
            }
            counts.merge(info.listClass(), (int) child.children().stream()
                .filter(c -> c.normalName().equals("li")).count(), Integer::sum);
            if (top != null && top.info().level() < info.level()) {
                var items = top.list().children().stream().filter(c -> c.normalName().equals("li")).toList();
                if (!items.isEmpty()) items.get(items.size() - 1).appendChild(child);
            }
            stack.push(new Open(info, child));
        }
    }

    static String olType(String cssType) {
        if (cssType == null) return null;
        return switch (cssType) {
            case "decimal", "decimal-leading-zero" -> "1";
            case "lower-latin", "lower-alpha" -> "a";
            case "upper-latin", "upper-alpha" -> "A";
            case "lower-roman" -> "i";
            case "upper-roman" -> "I";
            default -> null;
        };
    }

    // ---- indented paragraphs --------------------------------------------------

    private static void indent(Element body, Map<String, Map<String, String>> classes) {
        for (var p : new ArrayList<>(body.select("p"))) {
            if (hasAncestor(p, "li|td|th|blockquote")) continue;
            var margin = declarationsOf(p, classes).getOrDefault("margin-left", "");
            var m = PT.matcher(margin.trim());
            if (m.matches() && numeric(m.group(1)) >= 36) p.wrap("<blockquote></blockquote>");
        }
    }

    // For tests: the selectors parsed from a style sheet.
    static List<String> selectors(String css) {
        return new ArrayList<>(parseCss(css).keySet());
    }
}
