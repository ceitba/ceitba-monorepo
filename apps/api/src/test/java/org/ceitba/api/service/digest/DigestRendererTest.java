package org.ceitba.api.service.digest;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DigestRendererTest {

    static final DigestWeek WEEK = new DigestWeek(LocalDate.of(2026, 9, 28));
    static final DigestContent.Org ORG = new DigestContent.Org("ceitba", "CEITBA <b>&</b>");

    static DigestRenderer.Output render(String intro, DigestContent.Article a, DigestContent.Event e) {
        var personal = new DigestContent.Personal(
            a == null ? List.of() : List.of(a), e == null ? List.of() : List.of(e), List.of(ORG));
        return DigestRenderer.render(new DigestRenderer.Input("Asunto", WEEK, intro, personal, false,
            "https://ceitba.org.ar/newsletter/unsubscribe?token=abc", "https://ceitba.org.ar/newsletter"));
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
    void sectionsLinksAndPlainText() {
        var a = new DigestContent.Article("a1", "Título", "Resumen", null, LocalDate.of(2026, 9, 30), null);
        var e = new DigestContent.Event("e1", "Charla", LocalDate.of(2026, 10, 6),
            LocalTime.of(18, 0), LocalTime.of(20, 0), "Aula 101", ORG);
        var out = render(null, a, e);
        assertThat(out.html()).contains("La semana en ITBA", "Lo que pasó", "Lo que viene",
            "https://ceitba.org.ar/newsletter/articles/a1", "Independiente",
            "https://ceitba.org.ar/newsletter/unsubscribe?token=abc", "18:00 a 20:00 hs");
        assertThat(out.text()).contains("LO QUE PASÓ", "Título", "Charla", "Martes 6 de octubre",
            "https://ceitba.org.ar/newsletter/articles/a1", "Dejar de recibir este resumen: https://");
        assertThat(out.text()).contains("seguís a 1 organización");
    }

    @Test
    void emptySectionsSayso() {
        var html = render(null, null, null).html();
        assertThat(html).contains("no hubo artículos nuevos", "No hay eventos anunciados");
    }
}
