package org.ceitba.api.service.mail;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class MailLinkRewriterTest {

    static final String BASE = "https://ceitba.org.ar/api/v1/mail";
    static final String TID = "AbCdEfGhIjKlMnOpQrStUv";

    static String trackingUrl(int id) {
        return BASE + "/c/" + TID + "/" + id;
    }

    static final String HTML = "<html><head></head><body>"
        + "<a href=\"https://ceitba.org.ar/newsletter/articles/a1\"><img src=\"https://cdn.example/cover.png\" alt=\"\"></a>"
        + "<h2><a href=\"https://ceitba.org.ar/newsletter/articles/a1\" style=\"x\">Título &amp; <b>más</b></a></h2>"
        + "<a href=\"https://ceitba.org.ar/newsletter/articles/a1\">Leer más →</a>"
        + "<a target=\"_blank\" href=\"https://ceitba.org.ar/newsletter/correction?token=u1.c1.99.SIG&amp;vote=confirm\">Sí, es así</a>"
        + "<a href=\"https://ceitba.org.ar/newsletter/unsubscribe?token=u1.SIG%3D\">Dejar de recibir</a>"
        + "<a href=\"mailto:ceitba@itba.edu.ar\">mail</a>"
        + "</body></html>";

    static final String TEXT = "* Título\n  https://ceitba.org.ar/newsletter/articles/a1\n"
        + "  Sí: https://ceitba.org.ar/newsletter/correction?token=u1.c1.99.SIG&vote=confirm\n"
        + "Dejar de recibir: https://ceitba.org.ar/newsletter/unsubscribe?token=u1.SIG%3D\n";

    @Test
    void everyHttpLinkOfBothPartsIsWrappedAndThePixelAppended() {
        var shared = Map.of("https://ceitba.org.ar/newsletter/articles/a1", 1);
        var r = MailLinkRewriter.rewrite(HTML, TEXT, shared, MailLinkRewriterTest::trackingUrl,
            BASE + "/o/" + TID + ".gif");

        // No original http(s) link left in an href or in the text.
        assertThat(Pattern.compile("href=\"https?://(?!ceitba\\.org\\.ar/api/v1/mail/c/)").matcher(r.html()).find()).isFalse();
        assertThat(r.text()).doesNotContain("newsletter/");
        // The shared article link keeps its id (three anchors + text: one id).
        assertThat(r.html()).contains("href=\"" + trackingUrl(1) + "\"");
        assertThat(r.text()).contains(trackingUrl(1));
        // Images are not links: the cover src is untouched; non-http hrefs too.
        assertThat(r.html()).contains("src=\"https://cdn.example/cover.png\"");
        assertThat(r.html()).contains("href=\"mailto:ceitba@itba.edu.ar\"");
        // Per-reader links numbered from 1000, same id in HTML and text.
        assertThat(r.personalLinks()).hasSize(2);
        var vote = r.personalLinks().get(0);
        assertThat(vote.id()).isEqualTo(1000);
        // The HTML-escaped href (&amp;) is stored as the real URL.
        assertThat(vote.url()).isEqualTo("https://ceitba.org.ar/newsletter/correction?token=u1.c1.99.SIG&vote=confirm");
        assertThat(vote.urlKey()).isEqualTo("https://ceitba.org.ar/newsletter/correction?vote=confirm");
        assertThat(vote.label()).isEqualTo("Sí, es así");
        var unsub = r.personalLinks().get(1);
        assertThat(unsub.id()).isEqualTo(1001);
        assertThat(unsub.urlKey()).isEqualTo("https://ceitba.org.ar/newsletter/unsubscribe");
        assertThat(r.text()).contains("Sí: " + trackingUrl(1000)).contains("Dejar de recibir: " + trackingUrl(1001));
        // Pixel right before </body>, after everything else.
        assertThat(r.html()).endsWith("<img src=\"" + BASE + "/o/" + TID + ".gif\" width=\"1\" height=\"1\" alt=\"\" "
            + "style=\"display:block;width:1px;height:1px;border:0;\"></body></html>");
    }

    @Test
    void collectGivesDistinctLinksWithTheirFirstRealLabel() {
        var links = MailLinkRewriter.collect(HTML, TEXT);
        assertThat(links).extracting(MailLinkRewriter.Link::id).containsExactly(1, 2, 3);
        // The image link has no text: the title anchor's label is used.
        assertThat(links.get(0).label()).isEqualTo("Título & más");
        assertThat(links.get(0).url()).isEqualTo("https://ceitba.org.ar/newsletter/articles/a1");
    }

    @Test
    void urlKeyDropsOnlyTheToken() {
        assertThat(MailLinkRewriter.urlKey("https://x.org/a?token=s&vote=reject")).isEqualTo("https://x.org/a?vote=reject");
        assertThat(MailLinkRewriter.urlKey("https://x.org/a?TOKEN=s")).isEqualTo("https://x.org/a");
        assertThat(MailLinkRewriter.urlKey("https://x.org/a/b?vista=wiki")).isEqualTo("https://x.org/a/b?vista=wiki");
        assertThat(MailLinkRewriter.urlKey("https://x.org/a")).isEqualTo("https://x.org/a");
    }

    @Test
    void trackingIdsAreRandomAndOpaque() {
        String a = MailLinkRewriter.newTrackingId();
        String b = MailLinkRewriter.newTrackingId();
        assertThat(a).hasSize(22).isNotEqualTo(b);
        assertThat(MailLinkRewriter.isWellFormedTrackingId(a)).isTrue();
        assertThat(MailLinkRewriter.isWellFormedTrackingId("../../etc")).isFalse();
        assertThat(MailLinkRewriter.isWellFormedTrackingId("short")).isFalse();
        assertThat(MailLinkRewriter.isWellFormedTrackingId(null)).isFalse();
    }
}
