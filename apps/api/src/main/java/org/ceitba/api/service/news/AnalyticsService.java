package org.ceitba.api.service.news;

import org.ceitba.api.domain.news.AnalyticsEvent;
import org.ceitba.api.repository.news.AnalyticsEventRepository;
import org.ceitba.api.repository.news.ArticleVoteRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class AnalyticsService {

    private final AnalyticsEventRepository analyticsRepo;
    private final ArticleVoteRepository voteRepo;
    private final ArticleRepository articleRepo;

    public AnalyticsService(AnalyticsEventRepository analyticsRepo,
                            ArticleVoteRepository voteRepo,
                            ArticleRepository articleRepo) {
        this.analyticsRepo = analyticsRepo;
        this.voteRepo      = voteRepo;
        this.articleRepo   = articleRepo;
    }

    @Transactional
    public void ingestBatch(List<EventPayload> events, String ipHash) {
        var entities = events.stream()
            .map(e -> new AnalyticsEvent(
                e.type(), e.sessionId(),
                e.timestamp() != null
                    ? OffsetDateTime.ofInstant(Instant.ofEpochMilli(e.timestamp()), ZoneOffset.UTC)
                    : OffsetDateTime.now(),
                e.articleId(), e.category(), e.path(), ipHash))
            .toList();
        analyticsRepo.saveAll(entities);
    }

    public Summary summary(int days) {
        var since = OffsetDateTime.now().minusDays(days);
        long totalViews     = analyticsRepo.countArticleViewsSince(since);
        long uniqueVisitors = analyticsRepo.countUniqueVisitorsSince(since);

        List<ArticleStat> topArticles = analyticsRepo.topArticlesSince(since).stream()
            .map(row -> new ArticleStat((String) row[0], (String) row[1], ((Number) row[2]).longValue()))
            .toList();

        List<CategoryStat> categoryViews = analyticsRepo.categoryViewsSince(since).stream()
            .map(row -> new CategoryStat((String) row[0], ((Number) row[1]).longValue()))
            .toList();

        List<DailyStat> dailyViews = analyticsRepo.dailyViewsSince(since).stream()
            .map(row -> new DailyStat(row[0].toString(), ((Number) row[1]).longValue()))
            .toList();

        List<VoteStat> voteBreakdown = voteRepo.findAll().stream()
            .map(v -> {
                var title = articleRepo.findById(v.getArticleId())
                    .map(a -> a.getTitle()).orElse(v.getArticleId());
                return new VoteStat(v.getArticleId(), title, v.getUpCount(), v.getDownCount());
            })
            .filter(s -> s.up() + s.down() > 0)
            .toList();

        return new Summary(totalViews, uniqueVisitors, topArticles, categoryViews, dailyViews, voteBreakdown);
    }

    public record EventPayload(
        String type,
        String sessionId,
        Long   timestamp,
        String articleId,
        String category,
        String path
    ) {}

    public record Summary(
        long totalArticleViews,
        long uniqueVisitors,
        List<ArticleStat>  topArticles,
        List<CategoryStat> categoryViews,
        List<DailyStat>    dailyViews,
        List<VoteStat>     voteBreakdown
    ) {}

    public record ArticleStat(String articleId, String title, long views) {}
    public record CategoryStat(String category, long views) {}
    public record DailyStat(String date, long views) {}
    public record VoteStat(String articleId, String title, int up, int down) {}
}
