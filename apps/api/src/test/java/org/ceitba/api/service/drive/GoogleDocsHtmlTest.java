package org.ceitba.api.service.drive;

import org.jsoup.Jsoup;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

// A Google Docs HTML export (trimmed, in Google's format) through
// GoogleDocsHtml + DocHtmlSanitizer, as the Doc processing runs them.
class GoogleDocsHtmlTest {

    static String fixture() throws IOException {
        try (var in = GoogleDocsHtmlTest.class.getResourceAsStream("/fixtures/google-doc-export.html")) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    static org.jsoup.nodes.Element sanitized() throws IOException {
        var html = DocHtmlSanitizer.sanitize(GoogleDocsHtml.normalize(fixture()), Map.of(), "/assets/").html();
        return Jsoup.parseBodyFragment(html).body();
    }

    @Test
    void inlineFormattingAndAlignment() throws IOException {
        var body = sanitized();
        var intro = body.select("p").get(1);
        assertThat(intro.select("strong").text()).isEqualTo("negrita");
        assertThat(intro.select("em").text()).isEqualTo("cursiva");
        assertThat(intro.select("u").text()).isEqualTo("subrayado");
        assertThat(intro.select("s").text()).isEqualTo("tachado");
        assertThat(intro.select("sup").text()).isEqualTo("2");
        assertThat(intro.attr("data-align")).isEqualTo("center");
        assertThat(body.select("p").first().select("strong").text()).isEqualTo("Final de Gestión");
        // Link styling is not an underline tag.
        assertThat(body.select("a u")).isEmpty();
        assertThat(body.html()).doesNotContain("class=", "style=");
    }

    @Test
    void flatListsBecomeNested() throws IOException {
        var body = sanitized();
        var top = body.select("> ul");
        assertThat(top).hasSize(1);
        var items = top.first().select("> li");
        assertThat(items).hasSize(2);
        assertThat(items.get(0).select("> span > strong").text()).isEqualTo("Planeamiento");
        var level1 = items.get(0).select("> ul > li");
        assertThat(level1).hasSize(3);
        assertThat(level1.get(0).text()).isEqualTo("Estratégico");
        assertThat(level1.get(1).select("> ul > li").text()).isEqualTo("Corto plazo");
        assertThat(level1.get(2).text()).isEqualTo("Operativo");
        assertThat(items.get(1).text()).isEqualTo("Control");
    }

    @Test
    void orderedListsKeepTypeAndNumbering() throws IOException {
        var body = sanitized();
        var ols = body.select("> ol");
        assertThat(ols).hasSize(2);
        var first = ols.get(0);
        assertThat(first.attr("type")).isEqualTo("1");
        assertThat(first.select("> li")).hasSize(2);
        var sub = first.select("> li").get(0).select("> ol").first();
        assertThat(sub.attr("type")).isEqualTo("a");
        assertThat(sub.select("> li")).hasSize(2);
        // After the interruption numbering continues at 3.
        assertThat(ols.get(1).attr("start")).isEqualTo("3");
        assertThat(ols.get(1).text()).isEqualTo("Tercero");
    }

    @Test
    void indentedParagraphsBecomeBlockquotes() throws IOException {
        var body = sanitized();
        assertThat(body.select("blockquote").text()).isEqualTo("Cita indentada");
        // List items with margin-left are not blockquotes.
        assertThat(body.select("li blockquote")).isEmpty();
    }

    // Current exports: formatting inline, lists still by class (real sample, trimmed).
    @Test
    void inlineStylesFromCurrentExports() {
        var raw = "<html><head><style>.lst-kix_3hg-0>li:before{content:\"\\0025cf   \"}"
            + ".lst-kix_3hg-1>li:before{content:\"\\0025cb   \"}</style></head><body>"
            + "<ul class=\"lst-kix_3hg-0 start\"><li style=\"margin-left:36pt\"><span>Sistemas</span></li></ul>"
            + "<ul class=\"lst-kix_3hg-1 start\"><li><span>La </span><span style=\"color:#000000;font-weight:700;"
            + "text-decoration:underline;vertical-align:baseline;font-style:normal\">Ley 19550 </span></li></ul>"
            + "<p style=\"margin-left:36pt;text-align:right\"><span style=\"font-style:italic\">nota</span></p></body></html>";
        var body = Jsoup.parseBodyFragment(DocHtmlSanitizer.sanitize(GoogleDocsHtml.normalize(raw), Map.of(), "/a/").html()).body();
        var nested = body.select("> ul > li > ul > li").first();
        assertThat(nested.select("strong > u").text()).isEqualTo("Ley 19550");
        assertThat(body.select("blockquote > p[data-align=right] em").text()).isEqualTo("nota");
        assertThat(body.html()).doesNotContain("style=");
    }

    @Test
    void parsesFlatCss() {
        var rules = GoogleDocsHtml.parseCss("@import url(x);.c1,.c2{font-weight:700;color:red}.a>li:before{content:\"x\"}");
        assertThat(rules.keySet()).containsExactly(".c1", ".c2", ".a>li:before");
        assertThat(rules.get(".c2")).containsEntry("font-weight", "700");
        assertThat(GoogleDocsHtml.olType("lower-roman")).isEqualTo("i");
    }
}
