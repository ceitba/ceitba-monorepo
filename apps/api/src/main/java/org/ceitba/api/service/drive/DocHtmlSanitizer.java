package org.ceitba.api.service.drive;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.safety.Safelist;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

// Turns the HTML of a Google Doc export into something safe to inline in the
// SPA: Safelist.relaxed (no style, class, script, iframe, event handlers),
// images only from our asset endpoint, Google's link redirector unwrapped and
// links marked nofollow. Returns the body's inner HTML and its plain text.
public final class DocHtmlSanitizer {

    // Image sources are swapped for this absolute placeholder before cleaning
    // (the safelist only admits http/https img sources) and for the real
    // asset path afterwards.
    private static final String PLACEHOLDER = "https://drive-asset.invalid/";

    private DocHtmlSanitizer() {}

    public record Result(String html, String text, List<String> usedAssets) {}

    // srcToAsset: image src as written in the export (e.g. "images/image1.png")
    // -> stored asset name. assetUrlPrefix: e.g. "/api/v1/wiki/files/<id>/assets/".
    public static Result sanitize(String rawHtml, Map<String, String> srcToAsset, String assetUrlPrefix) {
        Document doc = Jsoup.parse(rawHtml == null ? "" : rawHtml);
        for (var img : doc.select("img")) {
            var src = img.attr("src");
            var asset = srcToAsset.get(src);
            if (asset == null) asset = srcToAsset.get(URLDecoder.decode(src, StandardCharsets.UTF_8));
            if (asset == null) {
                img.remove();
            } else {
                img.attr("src", PLACEHOLDER + asset);
            }
        }
        for (var a : doc.select("a[href]")) {
            a.attr("href", unwrapGoogleRedirect(a.attr("href")));
        }

        var safelist = Safelist.relaxed()
            .addEnforcedAttribute("a", "rel", "nofollow noopener noreferrer")
            .addEnforcedAttribute("a", "target", "_blank");
        var cleaned = Jsoup.clean(doc.body().html(), "", safelist,
            new Document.OutputSettings().prettyPrint(false));

        var out = Jsoup.parseBodyFragment(cleaned);
        out.outputSettings().prettyPrint(false);
        var used = new ArrayList<String>();
        for (var img : out.select("img")) {
            var src = img.attr("src");
            if (!src.startsWith(PLACEHOLDER)) {
                img.remove();
                continue;
            }
            var name = src.substring(PLACEHOLDER.length());
            if (!srcToAsset.containsValue(name)) {
                img.remove();
                continue;
            }
            img.attr("src", assetUrlPrefix + name);
            if (!used.contains(name)) used.add(name);
        }
        return new Result(out.body().html(), out.body().text(), used);
    }

    // https://www.google.com/url?q=<target>&sa=... -> <target>
    static String unwrapGoogleRedirect(String href) {
        try {
            var uri = URI.create(href);
            if (uri.getHost() != null && uri.getHost().endsWith("google.com") && "/url".equals(uri.getPath())
                    && uri.getRawQuery() != null) {
                for (var pair : uri.getRawQuery().split("&")) {
                    if (pair.startsWith("q=")) return URLDecoder.decode(pair.substring(2), StandardCharsets.UTF_8);
                }
            }
        } catch (IllegalArgumentException ignored) {
            // keep as is; the safelist drops unsupported protocols anyway
        }
        return href;
    }
}
