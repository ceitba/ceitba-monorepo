package org.ceitba.api.service.news;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.ArticleRepository.SitemapRow;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.service.mail.MutableClock;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.domain.Pageable;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

class NewsSitemapServiceTest {

    private final ArticleRepository articles = Mockito.mock(ArticleRepository.class);
    private final NewsEventRepository events = Mockito.mock(NewsEventRepository.class);
    private final MutableClock clock = new MutableClock(Instant.parse("2026-10-20T12:00:00Z"));
    private final NewsSitemapService service = new NewsSitemapService(articles, events, clock,
        new DigestProperties("https://ceitba.org.ar/newsletter", null, null, null, null, null, false));

    @Test
    void lastmodIsTheBuenosAiresDateOfUpdatedAtElsePublishedAt() {
        // 01:00Z is still the previous day in Buenos Aires (UTC-3).
        when(articles.findPublishedForSitemap(any(Pageable.class))).thenReturn(List.of(
            new SitemapRow("updated", OffsetDateTime.of(2026, 10, 10, 1, 0, 0, 0, ZoneOffset.UTC), LocalDate.of(2026, 1, 1)),
            new SitemapRow("never-updated", null, LocalDate.of(2026, 10, 5))));

        var lastmod = service.entries().stream().filter(e -> e.lastModified() != null)
            .collect(Collectors.toMap(NewsSitemapService.Entry::url, NewsSitemapService.Entry::lastModified));

        assertThat(lastmod).containsEntry("https://ceitba.org.ar/newsletter/articles/updated", LocalDate.of(2026, 10, 9));
        assertThat(lastmod).containsEntry("https://ceitba.org.ar/newsletter/articles/never-updated", LocalDate.of(2026, 10, 5));
    }

    @Test
    void entriesAreMemoisedForTenMinutes() {
        var first = new SitemapRow("first", null, LocalDate.of(2026, 10, 5));
        when(articles.findPublishedForSitemap(any(Pageable.class)))
            .thenReturn(List.of(first))
            .thenReturn(List.of(first, new SitemapRow("second", null, LocalDate.of(2026, 10, 6))));

        // Home + first article + events list.
        assertThat(service.entries()).hasSize(3);
        clock.advance(Duration.ofMinutes(9));
        assertThat(service.entries()).hasSize(3);
        clock.advance(Duration.ofMinutes(2));
        assertThat(service.entries()).hasSize(4);
    }
}
