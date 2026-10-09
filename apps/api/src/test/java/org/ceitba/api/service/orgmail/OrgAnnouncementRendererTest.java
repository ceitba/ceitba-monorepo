package org.ceitba.api.service.orgmail;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class OrgAnnouncementRendererTest {

    @Test
    void escapesTheBodyAndLinksOnlyHttpUrls() {
        var out = OrgAnnouncementRenderer.render("SABF & co", "violet",
            "<script>alert(1)</script>\n\nMirá https://sabf.org.ar/inscripcion?a=1&b=2. Y javascript:alert(1)",
            "https://x/unsubscribe?token=t", "https://x/organizations/sabf");

        assertThat(out.html()).doesNotContain("<script>").contains("&lt;script&gt;");
        assertThat(out.html()).contains("<a href=\"https://sabf.org.ar/inscripcion?a=1&amp;b=2\"");
        assertThat(out.html()).doesNotContain("href=\"javascript:");
        assertThat(out.html()).contains("SABF &amp; co").contains("#6D28D9");
        assertThat(out.text()).contains("https://x/unsubscribe?token=t");
    }

    @Test
    void aQuotedOrBracketedUrlStopsAtItsDelimiter() {
        var html = OrgAnnouncementRenderer.render("O", null, "Mirá \"https://a.org/x\" y <https://b.org>",
            "u", "p").html();
        assertThat(html).contains("&quot;<a href=\"https://a.org/x\" style=\"color:#1A3C6E\">https://a.org/x</a>&quot;")
            .contains("&lt;<a href=\"https://b.org\"");
    }

    @Test
    void blankLinesStartParagraphsAndSingleNewlinesBreakLines() {
        var html = OrgAnnouncementRenderer.render("O", null, "uno\ndos\n\ntres", "u", "p").html();
        assertThat(html).contains(">uno<br>dos</p>").contains(">tres</p>");
    }
}
