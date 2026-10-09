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

    // ── One organization (OrgAnalyticsService) ─────────────────────────────
    // Views of the org's articles and events, attributed to their current
    // organization. Days are ART calendar days.

    String ORG_VIEWS_WHERE = """
        ae.ts >= :since AND (
          (ae.type = 'article_view' AND ae.article_id IN (SELECT id FROM public.articles WHERE organization = :org))
          OR (ae.type = 'event_view' AND ae.event_id IN (SELECT id FROM public.news_events WHERE organization = :org)))
        """;

    // [article views, event views, distinct sessions]
    @Query(value = """
        SELECT count(*) FILTER (WHERE ae.type = 'article_view'),
               count(*) FILTER (WHERE ae.type = 'event_view'),
               count(DISTINCT ae.session_id)
        FROM public.analytics_events ae WHERE
        """ + ORG_VIEWS_WHERE, nativeQuery = true)
    List<Object[]> orgTotalsSince(@Param("org") String org, @Param("since") OffsetDateTime since);

    // [ART date, article views, event views] per day with any view.
    @Query(value = """
        SELECT (ae.ts AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS day,
               count(*) FILTER (WHERE ae.type = 'article_view'),
               count(*) FILTER (WHERE ae.type = 'event_view')
        FROM public.analytics_events ae WHERE
        """ + ORG_VIEWS_WHERE + """
        GROUP BY 1 ORDER BY 1
        """, nativeQuery = true)
    List<Object[]> orgDailySince(@Param("org") String org, @Param("since") OffsetDateTime since);

    // [article id, title, views], most viewed first.
    @Query(value = """
        SELECT a.id, a.title, count(*) AS views
        FROM public.analytics_events ae
        JOIN public.articles a ON a.id = ae.article_id
        WHERE ae.type = 'article_view' AND ae.ts >= :since AND a.organization = :org
        GROUP BY a.id, a.title
        ORDER BY views DESC, a.id
        LIMIT 10
        """, nativeQuery = true)
    List<Object[]> orgTopArticlesSince(@Param("org") String org, @Param("since") OffsetDateTime since);

    // [event id, title, date, signup mode, capacity, rsvps, views since]
    // for the org's events from `fromDate` on, latest first.
    @Query(value = """
        SELECT e.id, e.title, e.event_date, e.signup_mode, e.capacity,
               (SELECT count(*) FROM public.event_rsvps r WHERE r.event_id = e.id),
               (SELECT count(*) FROM public.analytics_events ae
                 WHERE ae.event_id = e.id AND ae.type = 'event_view' AND ae.ts >= :since)
        FROM public.news_events e
        WHERE e.organization = :org AND e.event_date >= :fromDate
        ORDER BY e.event_date DESC, e.id
        LIMIT 20
        """, nativeQuery = true)
    List<Object[]> orgEventsSince(@Param("org") String org, @Param("since") OffsetDateTime since,
                                  @Param("fromDate") java.time.LocalDate fromDate);
}
