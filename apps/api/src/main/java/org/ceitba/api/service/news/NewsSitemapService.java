package org.ceitba.api.service.news;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.NewsEvent;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

// The URLs behind /sitemap.xml (Caddy rewrites it to NewsSitemapController):
// the newsletter home, every published article and the events list with every
// event, the same sets the anonymous GET /v1/articles and GET /v1/events list.
// URLs are built like ArticleLinkPreviewService's.
@Service
public class NewsSitemapService {

    // sitemaps.org allows 50,000 URLs per file.
    static final int MAX_URLS = 50_000;
    private static final int PAGE_SIZE = 500;

    public record Entry(String url, LocalDate lastModified) {}

    private final ArticleService articles;
    private final NewsEventService events;
    private final String newsletterUrl;

    public NewsSitemapService(ArticleService articles, NewsEventService events, DigestProperties digest) {
        this.articles = articles;
        this.events = events;
        this.newsletterUrl = digest.publicBaseUrl();
    }

    @Transactional(readOnly = true)
    public List<Entry> entries() {
        var entries = new ArrayList<Entry>();
        entries.add(new Entry(newsletterUrl, null));
        for (int page = 0; entries.size() < MAX_URLS; page++) {
            var result = articles.findAll(null, null, "published", null, PageRequest.of(page, PAGE_SIZE));
            for (Article a : result.getContent()) {
                if (entries.size() >= MAX_URLS) break;
                entries.add(new Entry(newsletterUrl + "/articles/" + a.getId(), lastModified(a)));
            }
            if (!result.hasNext()) break;
        }
        if (entries.size() < MAX_URLS) entries.add(new Entry(newsletterUrl + "/events", null));
        // Null filters: every event the anonymous list shows. Events have no
        // updatedAt, so no lastmod.
        for (int page = 0; entries.size() < MAX_URLS; page++) {
            var result = events.findAll(null, null, null, null, PageRequest.of(page, PAGE_SIZE));
            for (NewsEvent e : result.getContent()) {
                if (entries.size() >= MAX_URLS) break;
                entries.add(new Entry(newsletterUrl + "/events/" + e.getId(), null));
            }
            if (!result.hasNext()) break;
        }
        return entries;
    }

    private static LocalDate lastModified(Article a) {
        if (a.getUpdatedAt() != null) return a.getUpdatedAt().toLocalDate();
        return a.getPublishedAt();
    }
}
