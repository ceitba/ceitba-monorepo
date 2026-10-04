package org.ceitba.api.service.digest;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DigestRendererTest {

    static final DigestWeek WEEK = new DigestWeek(LocalDate.of(2026, 9, 28));
    static final DigestContent.Org ORG = new DigestContent.Org("ceitba", "CEITBA <b>&</b>");
    static final String UNSUB = "https://ceitba.org.ar/newsletter/unsubscribe?token=abc";

    static DigestRenderer.Template template(String intro, DigestContent.Article a, DigestContent.Event e) {
        var shared = new DigestContent.Shared(a == null ? List.of() : List.of(a), e == null ? List.of() : List.of(e));
        return DigestRenderer.template(new DigestRenderer.Input("Asunto", WEEK, intro, shared,
            "https://ceitba.org.ar/newsletter"));
    }

    static DigestRenderer.Output render(String intro, DigestContent.Article a, DigestContent.Event e) {
        return template(intro, a, e).forReader(null, UNSUB);
    }

    @Test
    void escapesUserContent() {
        var a = new DigestContent.Article("id\"><script>", "<script>alert(1)</script>", "x & \"y\"",
            null, LocalDate.of(2026, 9, 30), ORG);
        var e = new DigestContent.Event("e1", "<img src=x onerror=alert(1)>", LocalDate.of(2026, 10, 6),
            LocalTime.of(18, 0), LocalTime.of(20, 0), "Aula <101>", ORG);
        var html = render("Hola <i>todos</i>\nsegunda línea", a, e).html();

        assertThat(html).doesNotContain("<script>").doesNotContain("<img src=x").doesNotContain("<i>todos");
        assertThat(html).contains("&lt;script&gt;alert(1)&lt;/script&gt;");
        assertThat(html).contains("x &amp; &quot;y&quot;");
        assertThat(html).contains("Hola &lt;i&gt;todos&lt;/i&gt;<br>segunda línea");
        assertThat(html).contains("Aula &lt;101&gt;");
        assertThat(html).contains("CEITBA &lt;b&gt;&amp;&lt;/b&gt;");
        // The id is URL-encoded in the link, so it cannot break out of href.
        assertThat(html).contains("/articles/id%22%3E%3Cscript%3E");
        // The unsubscribe URL is an attribute too.
        assertThat(template(null, null, null).forReader(null, "https://x/\"><b>").html())
            .contains("href=\"https://x/&quot;&gt;&lt;b&gt;\"");
    }

    @Test
    void coverImageOnlyWhenAbsoluteHttpUrl() {
        var rel = new DigestContent.Article("a1", "T", "E", "/ceitba-media/x.jpg", LocalDate.of(2026, 9, 30), ORG);
        assertThat(render(null, rel, null).html()).doesNotContain("<img");
        var js = new DigestContent.Article("a1", "T", "E", "javascript:alert(1)", LocalDate.of(2026, 9, 30), ORG);
        assertThat(render(null, js, null).html()).doesNotContain("<img");
        var abs = new DigestContent.Article("a1", "T", "E", "https://ceitba.org.ar/ceitba-media/x.jpg",
            LocalDate.of(2026, 9, 30), ORG);
        assertThat(render(null, abs, null).html()).contains("<img src=\"https://ceitba.org.ar/ceitba-media/x.jpg\"");
    }

    @Test
    void sectionsLinksFooterAndPlainText() {
        var a = new DigestContent.Article("a1", "Título", "Resumen", null, LocalDate.of(2026, 9, 30), null);
        var e = new DigestContent.Event("e1", "Charla", LocalDate.of(2026, 10, 6),
            LocalTime.of(18, 0), LocalTime.of(20, 0), "Aula 101", null);
        var out = render(null, a, e);
        assertThat(out.html()).contains("La semana en ITBA", "Lo que pasó", "Lo que viene",
            "https://ceitba.org.ar/newsletter/articles/a1", "Independiente", "Charla",
            "href=\"" + UNSUB + "\"", "18:00 a 20:00 hs", "seguís a CEITBA en ITBA News")
            .endsWith("</html>")
            .doesNotContain("/organizations");
        assertThat(out.text()).contains("LO QUE PASÓ", "Título", "Charla", "Martes 6 de octubre",
            "https://ceitba.org.ar/newsletter/articles/a1",
            "seguís a CEITBA en ITBA News", "Dejar de recibir este resumen: " + UNSUB);
    }

    @Test
    void personalSectionGoesBetweenContentAndFooter() {
        var t = template(null, null, null);
        var out = t.forReader(new DigestPersonalSection.Section("<tr><td>TU CUATRI</td></tr>", "TU CUATRI"), UNSUB);
        assertThat(out.html().indexOf("TU CUATRI"))
            .isGreaterThan(out.html().indexOf("Lo que viene"))
            .isLessThan(out.html().indexOf("seguís a CEITBA"));
        assertThat(out.text().indexOf("TU CUATRI"))
            .isGreaterThan(out.text().indexOf("LO QUE VIENE"))
            .isLessThan(out.text().indexOf("seguís a CEITBA"));
        // Only the per-reader parts differ between two readers.
        var other = t.forReader(null, "https://other");
        assertThat(other.html()).doesNotContain("TU CUATRI").contains("https://other");
    }

    @Test
    void emptySectionsSaySo() {
        var html = render(null, null, null).html();
        assertThat(html).contains("no hubo artículos nuevos", "No hay eventos anunciados");
    }
}
