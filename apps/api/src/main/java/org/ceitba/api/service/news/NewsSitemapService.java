package org.ceitba.api.service.news;

import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.ArticleRepository.SitemapRow;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

// The URLs behind /sitemap.xml (Caddy rewrites it to NewsSitemapController):
// the newsletter home, every published article and the events list with every
// event, the same sets the anonymous GET /v1/articles and GET /v1/events list.
// Lean queries (ids and dates, no bodies) mirror those lists' filters. URLs are
// built like ArticleLinkPreviewService's, with the id encoded as the SPA's
// canonical is. The result is kept for a few minutes: crawlers refetch it often.
@Service
public class NewsSitemapService {

    // sitemaps.org allows 50,000 URLs per file.
    static final int MAX_URLS = 50_000;
    private static final Duration TTL = Duration.ofMinutes(10);

    public record Entry(String url, LocalDate lastModified) {}

    private record Cached(List<Entry> entries, Instant builtAt) {}

    private final ArticleRepository articles;
    private final NewsEventRepository events;
    private final Clock clock;
    private final String newsletterUrl;
    // Two requests racing past an expired entry both rebuild; harmless.
    private volatile Cached cached;

    public NewsSitemapService(ArticleRepository articles, NewsEventRepository events, Clock clock,
                              DigestProperties digest) {
        this.articles = articles;
        this.events = events;
        this.clock = clock;
        // The host comes from DIGEST_PUBLIC_BASE_URL and must match the site origin:
        // robots.txt hardcodes https://ceitba.org.ar/sitemap.xml and the SPA's
        // canonicals use window.location.origin.
        this.newsletterUrl = digest.publicBaseUrl();
    }

    public List<Entry> entries() {
        var hit = cached;
        var now = clock.instant();
        if (hit != null && Duration.between(hit.builtAt(), now).compareTo(TTL) < 0) return hit.entries();
        var built = build();
        cached = new Cached(built, now);
        return built;
    }

    private List<Entry> build() {
        var entries = new ArrayList<Entry>();
        entries.add(new Entry(newsletterUrl, null));
        for (SitemapRow a : articles.findPublishedForSitemap(PageRequest.of(0, MAX_URLS - entries.size()))) {
            entries.add(new Entry(newsletterUrl + "/articles/" + segment(a.id()), lastModified(a)));
        }
        if (entries.size() < MAX_URLS) entries.add(new Entry(newsletterUrl + "/events", null));
        // Events have no updatedAt, so no lastmod. The bounds are the ones
        // NewsEventService.findAll applies to an unfiltered list.
        if (entries.size() < MAX_URLS) {
            var ids = events.findIdsForSitemap(LocalDate.of(1900, 1, 1), LocalDate.of(2999, 12, 31),
                PageRequest.of(0, MAX_URLS - entries.size()));
            for (String id : ids) entries.add(new Entry(newsletterUrl + "/events/" + segment(id), null));
        }
        return List.copyOf(entries);
    }

    // JS encodeURIComponent, which the SPA's canonical uses: everything but
    // A-Z a-z 0-9 - _ . ! ~ * ' ( ) is UTF-8 percent-encoded (UriUtils would
    // leave pchars like + : @ & = alone).
    private static String segment(String id) {
        var sb = new StringBuilder();
        for (byte b : id.getBytes(StandardCharsets.UTF_8)) {
            char c = (char) (b & 0xFF);
            boolean plain = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                || "-_.!~*'()".indexOf(c) >= 0;
            if (plain) sb.append(c);
            else sb.append('%').append(String.format("%02X", b & 0xFF));
        }
        return sb.toString();
    }

    private static LocalDate lastModified(SitemapRow a) {
        if (a.updatedAt() != null) return a.updatedAt().atZoneSameInstant(ClockConfig.ZONE).toLocalDate();
        return a.publishedAt();
    }
}
