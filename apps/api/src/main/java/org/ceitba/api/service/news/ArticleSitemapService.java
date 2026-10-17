package org.ceitba.api.service.news;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.news.Article;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

// The URLs behind /sitemap.xml (Caddy rewrites it to ArticleSitemapController):
// the newsletter home plus every published article, the same set the anonymous
// GET /v1/articles lists. URLs are built like ArticleLinkPreviewService's.
@Service
public class ArticleSitemapService {

    // sitemaps.org allows 50,000 URLs per file.
    static final int MAX_URLS = 50_000;
    private static final int PAGE_SIZE = 500;

    public record Entry(String url, LocalDate lastModified) {}

    private final ArticleService articles;
    private final String newsletterUrl;

    public ArticleSitemapService(ArticleService articles, DigestProperties digest) {
        this.articles = articles;
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
        return entries;
    }

    private static LocalDate lastModified(Article a) {
        if (a.getUpdatedAt() != null) return a.getUpdatedAt().toLocalDate();
        return a.getPublishedAt();
    }
}
