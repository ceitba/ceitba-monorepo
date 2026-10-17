package org.ceitba.api.web.news;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.service.news.ArticleSitemapService;
import org.ceitba.api.service.news.ArticleSitemapService.Entry;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.HtmlUtils;

import java.time.Duration;
import java.util.List;

// sitemap.xml for search engines: Caddy rewrites https://ceitba.org.ar/sitemap.xml
// here (the SPA can't produce it). Public: GET /v1/articles/** is permitted in
// SecurityConfig. The literal segment wins over ArticleController's GET /{id}.
@Tag(name = "Articles")
@RestController
public class ArticleSitemapController {

    private final ArticleSitemapService sitemap;

    public ArticleSitemapController(ArticleSitemapService sitemap) {
        this.sitemap = sitemap;
    }

    @GetMapping(value = "/v1/articles/sitemap.xml", produces = MediaType.APPLICATION_XML_VALUE)
    @Operation(summary = "sitemap.xml: the newsletter home and every published article")
    public ResponseEntity<String> sitemap() {
        return ResponseEntity.ok()
            .cacheControl(CacheControl.maxAge(Duration.ofHours(1)).cachePublic())
            .contentType(MediaType.parseMediaType("application/xml;charset=UTF-8"))
            .body(xml(sitemap.entries()));
    }

    static String xml(List<Entry> entries) {
        var sb = new StringBuilder(256 + entries.size() * 128)
            .append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
            .append("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
        for (var e : entries) {
            sb.append("  <url><loc>").append(HtmlUtils.htmlEscape(e.url(), "UTF-8")).append("</loc>");
            if (e.lastModified() != null) {
                sb.append("<lastmod>").append(e.lastModified()).append("</lastmod>");
            }
            sb.append("</url>\n");
        }
        return sb.append("</urlset>\n").toString();
    }
}
