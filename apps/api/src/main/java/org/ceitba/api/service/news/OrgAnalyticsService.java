package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.repository.PushLogRepository;
import org.ceitba.api.repository.news.AnalyticsEventRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// Stats of one organization for its members (docs/ORGANIZATIONS.md): views of
// its articles and events, followers, and push reach, over the last `days`
// ART calendar days (today included). Views count toward the article's or
// event's current organization; "visitors" are distinct browser sessions;
// the follower series counts current followers by the day they followed
// (unfollows are not recorded).
@Service
public class OrgAnalyticsService {

    static final int MAX_DAYS = 365;

    private final AnalyticsEventRepository analytics;
    private final UserFollowRepository follows;
    private final PushLogRepository pushLog;
    private final OrganizationRepository orgs;
    private final Clock clock;

    public OrgAnalyticsService(AnalyticsEventRepository analytics, UserFollowRepository follows,
                               PushLogRepository pushLog, OrganizationRepository orgs, Clock clock) {
        this.analytics = analytics;
        this.follows = follows;
        this.pushLog = pushLog;
        this.orgs = orgs;
        this.clock = clock;
    }

    public record OrgAnalytics(int days, long articleViews, long eventViews, long uniqueVisitors,
                               List<DailyViews> daily, List<ArticleViews> topArticles, List<EventStats> events,
                               Followers followers, PushReach pushes) {}

    public record DailyViews(LocalDate date, long articleViews, long eventViews) {}

    public record ArticleViews(String articleId, String title, long views) {}

    public record EventStats(String eventId, String title, LocalDate date, String signupMode, Integer capacity,
                             long rsvpCount, long views) {}

    // `cumulative`: current followers who had followed by the end of each day.
    public record Followers(long total, long newInPeriod, List<FollowerPoint> cumulative) {}

    public record FollowerPoint(LocalDate date, long count) {}

    public record PushReach(long pushes, long devicesTargeted, long devicesReached) {}

    @Transactional(readOnly = true)
    public OrgAnalytics summary(String org, int days) {
        if (days < 1 || days > MAX_DAYS) throw new ValidationException("days", days, "must be 1-" + MAX_DAYS);
        if (!orgs.existsById(org)) throw new ResourceNotFoundException("Organization", org);
        var today = LocalDate.now(clock);
        var firstDay = today.minusDays(days - 1L);
        var since = firstDay.atStartOfDay(clock.getZone()).toOffsetDateTime();

        var totals = first(analytics.orgTotalsSince(org, since));

        var viewsByDay = new HashMap<LocalDate, long[]>();
        for (var row : analytics.orgDailySince(org, since)) {
            viewsByDay.put(date(row[0]), new long[] { num(row[1]), num(row[2]) });
        }
        var daily = new ArrayList<DailyViews>();
        for (var d = firstDay; !d.isAfter(today); d = d.plusDays(1)) {
            var v = viewsByDay.getOrDefault(d, new long[2]);
            daily.add(new DailyViews(d, v[0], v[1]));
        }

        var top = analytics.orgTopArticlesSince(org, since).stream()
            .map(r -> new ArticleViews((String) r[0], (String) r[1], num(r[2])))
            .toList();

        var events = analytics.orgEventsSince(org, since, firstDay).stream()
            .map(r -> new EventStats((String) r[0], (String) r[1], date(r[2]), (String) r[3],
                r[4] == null ? null : ((Number) r[4]).intValue(), num(r[5]), num(r[6])))
            .toList();

        long before = follows.countFollowersBefore(org, since);
        Map<LocalDate, Long> newByDay = new HashMap<>();
        for (var row : follows.dailyNewFollowersSince(org, since)) newByDay.put(date(row[0]), num(row[1]));
        var cumulative = new ArrayList<FollowerPoint>();
        long running = before;
        for (var d = firstDay; !d.isAfter(today); d = d.plusDays(1)) {
            running += newByDay.getOrDefault(d, 0L);
            cumulative.add(new FollowerPoint(d, running));
        }
        long total = follows.countByOrganization(org);

        var push = first(pushLog.totalsForOrgSince(org, since));

        return new OrgAnalytics(days, num(totals[0]), num(totals[1]), num(totals[2]), daily, top, events,
            new Followers(total, running - before, cumulative),
            new PushReach(num(push[0]), num(push[1]), num(push[2])));
    }

    private static Object[] first(List<Object[]> rows) {
        return rows.isEmpty() ? new Object[] { 0L, 0L, 0L } : rows.get(0);
    }

    private static long num(Object o) {
        return o == null ? 0 : ((Number) o).longValue();
    }

    private static LocalDate date(Object o) {
        return o instanceof Date d ? d.toLocalDate() : (LocalDate) o;
    }
}
