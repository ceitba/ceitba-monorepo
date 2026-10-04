package org.ceitba.api.service.kb;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

// Deterministic quality checks of a page body that need no database (see
// docs/SUBJECT-WIKI.md "Quality checks"). Each error starts with its reject
// reason ("latex_format:", "meta_section:", "self_link:"), which is also what
// the retry prompt and the eval's rejectReasons key on. Code is ignored.
public final class KbStyleChecks {

    public static final String LATEX_FORMAT = "latex_format";
    public static final String META_SECTION = "meta_section";
    public static final String SELF_LINK = "self_link";

    private KbStyleChecks() {}

    // Backslash commands that only make sense as math (the SPA renders math with KaTeX
    // only inside $...$ / $$...$$).
    private static final String COMMANDS = "bar|hat|overline|underline|vec|frac|dfrac|tfrac|sum|prod|int|lim|sqrt|binom"
        + "|pm|mp|cdot|cdots|ldots|times|div|leq|geq|neq|approx|equiv|infty|partial|nabla|sim"
        + "|mu|sigma|alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|pi|rho|tau|phi|varphi|chi|psi|omega|eta"
        + "|kappa|nu|xi|zeta|Delta|Sigma|Omega|Gamma|Theta|Lambda|Pi|Phi|Psi"
        + "|text|mathbb|mathrm|mathbf|left|right|begin|end|rightarrow|Rightarrow|leftarrow|Leftarrow";
    private static final Pattern BARE_COMMAND = Pattern.compile("\\\\(?:" + COMMANDS + ")(?![A-Za-z])");
    private static final Pattern DOUBLED_IN_PROSE = Pattern.compile("\\\\\\\\[A-Za-z]");
    private static final Pattern DOUBLED_COMMAND = Pattern.compile("\\\\\\\\(?:" + COMMANDS + ")(?![A-Za-z])");
    private static final Pattern LINE_END_BACKSLASH = Pattern.compile("(?<!\\\\)\\\\[ \\t]*$", Pattern.MULTILINE);

    // The text with math spans blanked out (line structure kept) and the count of
    // unbalanced `$` delimiters. A span is $$...$$ (may cross lines) or $...$ (one paragraph).
    record Math(String prose, List<String> spans, int unbalanced) {}

    static Math splitMath(String text) {
        var prose = new StringBuilder();
        var spans = new ArrayList<String>();
        int unbalanced = 0;
        int n = text.length();
        int i = 0;
        while (i < n) {
            char c = text.charAt(i);
            if (c == '\\' && i + 1 < n && text.charAt(i + 1) == '$') {   // escaped dollar: a literal
                prose.append("  ");
                i += 2;
                continue;
            }
            if (c != '$') {
                prose.append(c);
                i++;
                continue;
            }
            boolean block = i + 1 < n && text.charAt(i + 1) == '$';
            var delim = block ? "$$" : "$";
            int from = i + delim.length();
            int close = from;
            while (true) {
                close = text.indexOf(delim, close);
                if (close < 0) break;
                if (text.charAt(close - 1) == '\\') { close++; continue; }
                break;
            }
            int blank = text.indexOf("\n\n", from);
            if (close < 0 || (!block && blank >= 0 && blank < close) || close == from) {
                unbalanced++;
                prose.append(' ');
                i += delim.length();
                continue;
            }
            spans.add(text.substring(from, close));
            for (int k = i; k < close + delim.length(); k++) prose.append(text.charAt(k) == '\n' ? '\n' : ' ');
            i = close + delim.length();
        }
        return new Math(prose.toString(), spans, unbalanced);
    }

    public static List<String> latexErrors(String body) {
        var out = new ArrayList<String>();
        var m = splitMath(KbWikilinks.stripCode(body));
        if (m.unbalanced() > 0) {
            out.add(LATEX_FORMAT + ": unbalanced $ delimiters (" + m.unbalanced() + " unmatched); every formula "
                + "goes between $...$ (or $$...$$), on one paragraph; write a literal dollar or a price as \\$ (e.g. \\$2.000)");
        }
        var bare = BARE_COMMAND.matcher(m.prose());
        if (bare.find()) {
            out.add(LATEX_FORMAT + ": math command '" + bare.group() + "' outside $...$; put the whole formula "
                + "between $ delimiters");
        }
        var doubled = DOUBLED_IN_PROSE.matcher(m.prose());
        if (doubled.find()) {
            out.add(LATEX_FORMAT + ": doubled backslash '" + doubled.group() + "' in the text; use a single "
                + "backslash and only inside $...$");
        }
        var trailing = LINE_END_BACKSLASH.matcher(m.prose());
        if (trailing.find()) {
            out.add(LATEX_FORMAT + ": line ends with a stray backslash; a formula must not be split across lines");
        }
        for (var span : m.spans()) {
            if (LINE_END_BACKSLASH.matcher(span).find()) {
                out.add(LATEX_FORMAT + ": a formula has a stray backslash at the end of a line; write each "
                    + "formula on one line");
                break;
            }
        }
        for (var span : m.spans()) {
            var d = DOUBLED_COMMAND.matcher(span);
            if (d.find()) {
                out.add(LATEX_FORMAT + ": doubled backslash '" + d.group() + "' inside a formula; use '"
                    + d.group().substring(1) + "'");
                break;
            }
        }
        return out;
    }

    // ---- meta sections: notes to the editor, not content ----

    private static final Pattern HEADING = Pattern.compile("^#{1,6}\\s+(.*?)\\s*#*\\s*$");
    private static final Pattern BULLET = Pattern.compile("^\\s*(?:[-*+]|\\d+[.)])\\s+(.*)$");
    private static final Pattern HEADING_META = Pattern.compile(
        "^(?:que falta\\b.*|por completar\\b.*|a completar\\b.*|por hacer|pendientes?|fixme\\b.*)$");
    private static final Pattern LINE_META = Pattern.compile(
        "^\\W*(?:(?:por completar|a completar)\\b.*"
            + "|agregar (?:enlaces|links|vinculos|paginas|referencias|secciones)\\b.*"
            + "|pendiente\\s*[:\\-]\\s*(?:agregar|completar|revisar|anadir|incluir|falta|ampliar|documentar).*)$");
    // Case-sensitive: "todo" means "all" in Spanish.
    private static final Pattern MARKER = Pattern.compile("^\\W*(?:TODO|FIXME)\\b|\\[(?:TODO|FIXME)\\b|\\bTODO:");

    public static List<String> metaSectionErrors(String body) {
        var out = new ArrayList<String>();
        for (var raw : KbWikilinks.stripCode(body).split("\n", -1)) {
            var line = raw.strip();
            if (line.isEmpty()) continue;
            var h = HEADING.matcher(line);
            if (h.matches()) {
                var text = h.group(1).replace("*", "").replace("_", "").strip();
                if (HEADING_META.matcher(fold(text)).matches() || text.equals("TODO")) {
                    out.add(META_SECTION + ": heading '" + text + "' is a note to the editor, not content; remove "
                        + "the section");
                }
                continue;
            }
            var b = BULLET.matcher(line);
            var text = (b.matches() ? b.group(1) : line).replace("*", "").strip();
            if (MARKER.matcher(text).find() || LINE_META.matcher(fold(text)).matches()) {
                out.add(META_SECTION + ": '" + preview(text) + "' is a note to the editor, not content; remove it");
            }
        }
        return out.size() > 3 ? out.subList(0, 3) : out;
    }

    // ---- self links ----

    // A link to the page's own slug without an anchor ([[slug#section]] and [[#section]] are fine).
    public static List<String> selfLinkErrors(KbWikilinks.Parsed links, String subjectId, String slug) {
        var out = new ArrayList<String>();
        if (slug == null) return out;
        for (var l : links.links()) {
            if (l.anchor() == null && l.subjectId().equals(subjectId) && l.slug().equals(slug)) {
                out.add(SELF_LINK + ": the page links to itself with [[" + l.raw() + "]]; remove the link (links "
                    + "to a heading of the same page, [[#heading]], are fine)");
            }
        }
        return out;
    }

    private static String fold(String s) {
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "").toLowerCase(Locale.ROOT);
    }

    private static String preview(String s) {
        return s.length() <= 80 ? s : s.substring(0, 77) + "...";
    }
}
