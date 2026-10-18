package org.ceitba.api.service.news;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.news.Article;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.time.LocalDate;
import java.util.List;
import java.util.regex.Pattern;

// What a chat app shows when someone shares an article link (WhatsApp,
// Telegram, Slack…). Their crawlers don't run the SPA, so Caddy routes them
// to ArticleLinkPreviewController instead (infra/caddy/Caddyfile). Only
// published articles have a preview.
@Service
public class ArticleLinkPreviewService {

    static final int MAX_DESCRIPTION = 200;
    private static final Pattern MARKDOWN_IMAGE = Pattern.compile("!\\[[^\\]]*\\]\\((https?://[^\\s)]+)");
    private static final Pattern MARKDOWN_SYNTAX = Pattern.compile("!?\\[([^\\]]*)\\]\\([^)]*\\)|[*_#>`]");

    public record LinkPreview(String title, String description, String url, String imageUrl,
                              String siteName, LocalDate publishedAt) {}

    private final ArticleService articles;
    private final String newsletterUrl;
    private final String origin;

    // The digest's public newsletter URL (e.g. https://ceitba.org.ar/newsletter)
    // is also the canonical base of article links.
    public ArticleLinkPreviewService(ArticleService articles, DigestProperties digest) {
        this.articles = articles;
        this.newsletterUrl = digest.publicBaseUrl();
        var base = URI.create(newsletterUrl);
        this.origin = base.getScheme() + "://" + base.getRawAuthority();
    }

    @Transactional(readOnly = true)
    public LinkPreview preview(String id) {
        Article a = articles.findById(id, false);
        var org = a.getOrganization();
        return new LinkPreview(
            a.getTitle(),
            description(a),
            newsletterUrl + "/articles/" + a.getId(),
            image(a),
            org != null && org.getName() != null ? org.getName() + " · ITBA News" : "ITBA News",
            a.getPublishedAt());
    }

    // The excerpt, else the first paragraph without its markdown. Keep in sync
    // with articleDescription in apps/web/src/newsletter/utils/seo.ts.
    private static String description(Article a) {
        String text = a.getExcerpt();
        if (text == null || text.isBlank()) {
            text = firstParagraph(a.getBody());
        }
        text = text.replaceAll("\\s+", " ").trim();
        return text.length() <= MAX_DESCRIPTION ? text : text.substring(0, MAX_DESCRIPTION - 1).trim() + "…";
    }

    private static String firstParagraph(List<String> body) {
        if (body == null) return "";
        for (var p : body) {
            var plain = p == null ? "" : MARKDOWN_SYNTAX.matcher(p).replaceAll("$1").trim();
            if (!plain.isEmpty()) return plain;
        }
        return "";
    }

    // Cover image, else the first image in the body, else the org's logo.
    private String image(Article a) {
        if (a.getCoverImage() != null && !a.getCoverImage().isBlank()) return absolute(a.getCoverImage());
        if (a.getBody() != null) {
            for (var p : a.getBody()) {
                var m = p == null ? null : MARKDOWN_IMAGE.matcher(p);
                if (m != null && m.find()) return m.group(1);
            }
        }
        var org = a.getOrganization();
        if (org != null && org.getLogoUrl() != null && !org.getLogoUrl().isBlank()) return absolute(org.getLogoUrl());
        return null;
    }

    private String absolute(String url) {
        return url.startsWith("/") && !url.startsWith("//") ? origin + url : url;
    }
}
