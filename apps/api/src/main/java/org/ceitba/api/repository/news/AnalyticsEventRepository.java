package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.AnalyticsEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;

public interface AnalyticsEventRepository extends JpaRepository<AnalyticsEvent, Long> {

    @Query(value = """
        SELECT COUNT(*) FROM public.analytics_events
        WHERE type = 'article_view' AND ts >= :since
        """, nativeQuery = true)
    long countArticleViewsSince(@Param("since") OffsetDateTime since);

    @Query(value = """
        SELECT COUNT(DISTINCT session_id) FROM public.analytics_events
        WHERE ts >= :since
        """, nativeQuery = true)
    long countUniqueVisitorsSince(@Param("since") OffsetDateTime since);

    @Query(value = """
        SELECT ae.article_id, a.title, COUNT(*) AS views
        FROM public.analytics_events ae
        JOIN public.articles a ON a.id = ae.article_id
        WHERE ae.type = 'article_view' AND ae.ts >= :since AND ae.article_id IS NOT NULL
        GROUP BY ae.article_id, a.title
        ORDER BY views DESC
        LIMIT 10
        """, nativeQuery = true)
    List<Object[]> topArticlesSince(@Param("since") OffsetDateTime since);

    @Query(value = """
        SELECT ae.category, COUNT(*) AS views
        FROM public.analytics_events ae
        WHERE ae.type = 'category_filter' AND ae.ts >= :since AND ae.category IS NOT NULL
        GROUP BY ae.category
        ORDER BY views DESC
        """, nativeQuery = true)
    List<Object[]> categoryViewsSince(@Param("since") OffsetDateTime since);

    @Query(value = """
        SELECT date_trunc('day', ts)::date AS day, COUNT(*) AS views
        FROM public.analytics_events
        WHERE type = 'article_view' AND ts >= :since
        GROUP BY 1
        ORDER BY 1
        """, nativeQuery = true)
    List<Object[]> dailyViewsSince(@Param("since") OffsetDateTime since);
}
