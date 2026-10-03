package org.ceitba.api.service.drive;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class DocHtmlSanitizerTest {

    static final String PREFIX = "/api/v1/wiki/files/abc/assets/";

    @Test
    void rewritesKnownImagesAndDropsTheRest() {
        var html = """
            <html><head><style>.c1{color:red}</style><script>alert(1)</script></head>
            <body class="doc"><p class="c1" style="color:red">Hola <b>mundo</b></p>
            <img src="images/image1.png" style="width:10px" onerror="alert(1)">
            <img src="images/missing.png">
            <img src="https://evil.example/track.gif">
            <img src="data:image/png;base64,AAAA">
            <iframe src="https://evil.example"></iframe>
            </body></html>""";
        var r = DocHtmlSanitizer.sanitize(html, Map.of("images/image1.png", "image1.png"), PREFIX);

        assertThat(r.html()).contains("<img src=\"" + PREFIX + "image1.png\"");
        assertThat(r.html()).doesNotContain("style", "class=", "script", "onerror", "iframe", "evil.example",
            "missing.png", "data:image");
        assertThat(r.html()).contains("<b>mundo</b>");
        assertThat(r.usedAssets()).containsExactly("image1.png");
        assertThat(r.text()).isEqualTo("Hola mundo");
    }

    @Test
    void decodesImageSourcesWrittenUrlEncoded() {
        var r = DocHtmlSanitizer.sanitize("<img src=\"images/image%201.png\">",
            Map.of("images/image 1.png", "image_1.png"), PREFIX);
        assertThat(r.usedAssets()).containsExactly("image_1.png");
    }

    @Test
    void unwrapsGoogleRedirectsAndHardensLinks() {
        var r = DocHtmlSanitizer.sanitize(
            "<a href=\"https://www.google.com/url?q=https://itba.edu.ar/x%3Fa%3D1&sa=D\">ITBA</a>"
                + "<a href=\"javascript:alert(1)\">bad</a>", Map.of(), PREFIX);
        assertThat(r.html()).contains("href=\"https://itba.edu.ar/x?a=1\"");
        assertThat(r.html()).contains("rel=\"nofollow noopener noreferrer\"");
        assertThat(r.html()).doesNotContain("javascript");
    }
}
