package org.ceitba.api.web.news;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.service.news.ArticleLinkPreviewService;
import org.ceitba.api.service.news.ArticleLinkPreviewService.LinkPreview;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.HtmlUtils;

import java.time.Duration;

// Open Graph page for an article link shared in a chat app. Caddy sends
// link-preview crawlers asking for /newsletter/articles/{id} here (they don't
// run JavaScript, so the SPA would give them an empty page); people never
// land on it, but if one does, the link takes them to the article.
// Public: GET /v1/articles/** is permitted in SecurityConfig.
@Tag(name = "Articles")
@RestController
public class ArticleLinkPreviewController {

    private final ArticleLinkPreviewService previews;

    public ArticleLinkPreviewController(ArticleLinkPreviewService previews) {
        this.previews = previews;
    }

    @GetMapping(value = "/v1/articles/{id}/preview", produces = MediaType.TEXT_HTML_VALUE)
    @Operation(summary = "Open Graph HTML for link previews of a published article (404 otherwise)")
    public ResponseEntity<String> preview(@PathVariable String id) {
        var html = MediaType.parseMediaType("text/html;charset=UTF-8");
        try {
            return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic())
                .contentType(html)
                .body(html(previews.preview(id)));
        } catch (ResourceNotFoundException e) {
            // The JSON error body can't be served to a crawler that only accepts HTML.
            return ResponseEntity.status(HttpStatus.NOT_FOUND).contentType(html)
                .body("<!doctype html>\n<html lang=\"es\"><head><meta charset=\"utf-8\"><title>ITBA News</title></head>"
                    + "<body><p>Artículo no encontrado.</p></body></html>\n");
        }
    }

    static String html(LinkPreview p) {
        var title = esc(p.title());
        var description = esc(p.description());
        var url = esc(p.url());
        var sb = new StringBuilder(1024)
            .append("<!doctype html>\n<html lang=\"es\">\n<head>\n<meta charset=\"utf-8\">\n")
            .append("<title>").append(title).append("</title>\n")
            .append("<meta name=\"description\" content=\"").append(description).append("\">\n")
            .append("<link rel=\"canonical\" href=\"").append(url).append("\">\n")
            .append("<meta property=\"og:type\" content=\"article\">\n")
            .append("<meta property=\"og:locale\" content=\"es_AR\">\n")
            .append("<meta property=\"og:site_name\" content=\"").append(esc(p.siteName())).append("\">\n")
            .append("<meta property=\"og:title\" content=\"").append(title).append("\">\n")
            .append("<meta property=\"og:description\" content=\"").append(description).append("\">\n")
            .append("<meta property=\"og:url\" content=\"").append(url).append("\">\n");
        if (p.imageUrl() != null) {
            sb.append("<meta property=\"og:image\" content=\"").append(esc(p.imageUrl())).append("\">\n");
        }
        if (p.publishedAt() != null) {
            sb.append("<meta property=\"article:published_time\" content=\"").append(p.publishedAt()).append("\">\n");
        }
        sb.append("<meta name=\"twitter:card\" content=\"")
            .append(p.imageUrl() != null ? "summary_large_image" : "summary").append("\">\n")
            .append("</head>\n<body>\n")
            .append("<h1>").append(title).append("</h1>\n")
            .append("<p>").append(description).append("</p>\n")
            .append("<p><a href=\"").append(url).append("\">Leer en ITBA News</a></p>\n")
            .append("</body>\n</html>\n");
        return sb.toString();
    }

    private static String esc(String s) {
        return s == null ? "" : HtmlUtils.htmlEscape(s, "UTF-8");
    }
}
