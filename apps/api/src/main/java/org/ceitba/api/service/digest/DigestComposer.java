package org.ceitba.api.service.digest;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.digest.DigestIssue;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.news.UserFollow;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.service.mail.OutgoingEmail;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

// Builds what each reader gets: the issue's candidates, the reader's
// personalised selection and the rendered email. Shared by DigestService
// (previews, test sends, recipient snapshot) and DigestSender (the batch).
@Component
public class DigestComposer {

    // Entity-free copy of an issue's editable fields.
    public record Issue(UUID id, DigestWeek week, String subject, String intro,
                        List<String> excludedArticleIds, List<String> excludedEventIds) {

        static Issue of(DigestIssue i) {
            return new Issue(i.getId(), new DigestWeek(i.getWeekStart()), i.getSubject(), i.getIntro(),
                i.getExcludedArticleIds(), i.getExcludedEventIds());
        }
    }

    public record Recipient(UUID userId, String email) {}

    private final ArticleRepository articles;
    private final NewsEventRepository events;
    private final OrganizationRepository orgs;
    private final UserFollowRepository follows;
    private final UserRepository users;
    private final DigestUnsubscribeTokens tokens;
    private final DigestProperties props;

    public DigestComposer(ArticleRepository articles, NewsEventRepository events, OrganizationRepository orgs,
                          UserFollowRepository follows, UserRepository users, DigestUnsubscribeTokens tokens,
                          DigestProperties props) {
        this.articles = articles;
        this.events = events;
        this.orgs = orgs;
        this.follows = follows;
        this.users = users;
        this.tokens = tokens;
        this.props = props;
    }

    // Every candidate of the week, before staff exclusions and personalisation.
    @Transactional(readOnly = true)
    public DigestContent.Candidates candidates(DigestWeek week) {
        var a = articles.findPublishedBetween(week.weekStart(), week.weekEnd()).stream()
            .map(x -> new DigestContent.Article(x.getId(), x.getTitle(), x.getExcerpt(), x.getCoverImage(),
                x.getPublishedAt(), org(x.getOrganization())))
            .toList();
        var e = events.findOrgEventsBetween(week.eventsFrom(), week.eventsTo()).stream()
            .map(x -> new DigestContent.Event(x.getId(), x.getTitle(), x.getEventDate(), x.getStartTime(),
                x.getEndTime(), x.getLocation(), org(x.getOrganization())))
            .toList();
        return new DigestContent.Candidates(week, a, e);
    }

    @Transactional(readOnly = true)
    public Map<String, DigestContent.Org> organizations() {
        return orgs.findAll().stream()
            .map(DigestComposer::org)
            .collect(Collectors.toMap(DigestContent.Org::slug, Function.identity(), (x, y) -> x, LinkedHashMap::new));
    }

    @Transactional(readOnly = true)
    public Set<String> followedSlugs(UUID userId) {
        return follows.findByUserId(userId).stream().map(UserFollow::getOrganization).collect(Collectors.toSet());
    }

    // As if the reader followed every org (preview mode=all).
    public DigestContent.Personal forAllOrgs(Issue issue, DigestContent.Candidates candidates) {
        return DigestSelection.personalise(candidates, null,
            issue.excludedArticleIds(), issue.excludedEventIds(), null);
    }

    public DigestContent.Personal forReader(Issue issue, DigestContent.Candidates candidates,
                                            Set<String> followed, Map<String, DigestContent.Org> orgIndex) {
        var followedOrgs = followed.stream()
            .map(slug -> orgIndex.getOrDefault(slug, new DigestContent.Org(slug, slug)))
            .sorted(Comparator.comparing(o -> o.name().toLowerCase()))
            .toList();
        return DigestSelection.personalise(candidates, followed,
            issue.excludedArticleIds(), issue.excludedEventIds(), followedOrgs);
    }

    // Who gets the issue: digest not disabled, allowed domain, follows at
    // least one org, and a non-empty personalised digest.
    @Transactional(readOnly = true)
    public List<Recipient> recipients(Issue issue, DigestContent.Candidates candidates) {
        Map<UUID, Set<String>> byUser = new HashMap<>();
        for (var f : follows.findAll()) {
            byUser.computeIfAbsent(f.getUserId(), k -> new HashSet<>()).add(f.getOrganization());
        }
        var result = new ArrayList<Recipient>();
        for (User u : users.findByDigestEmailEnabledTrue()) {
            if (!props.isAllowedRecipient(u.getEmail())) continue;
            var followed = byUser.get(u.getId());
            if (followed == null || followed.isEmpty()) continue;
            var personal = DigestSelection.personalise(candidates, followed,
                issue.excludedArticleIds(), issue.excludedEventIds(), List.of());
            if (personal.isEmpty()) continue;
            result.add(new Recipient(u.getId(), u.getEmail().trim()));
        }
        return result;
    }

    public DigestRenderer.Output render(Issue issue, DigestContent.Personal personal, boolean allOrgs, UUID readerId) {
        return DigestRenderer.render(new DigestRenderer.Input(issue.subject(), issue.week(), issue.intro(),
            personal, allOrgs, unsubscribePageUrl(readerId), props.publicBaseUrl()));
    }

    public OutgoingEmail email(Issue issue, DigestContent.Personal personal, UUID userId, String to, boolean test) {
        var out = render(issue, personal, false, userId);
        String token = tokens.issue(userId);
        var headers = new LinkedHashMap<String, String>();
        // RFC 2369 + RFC 8058 one-click: mail clients POST to the API directly.
        headers.put("List-Unsubscribe", "<" + props.apiBaseUrl() + "/v1/digests/unsubscribe?token=" + enc(token) + ">");
        headers.put("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
        headers.put("List-Id", "La semana en ITBA <digest.ceitba.org.ar>");
        if (!test) headers.put("Precedence", "bulk");
        String subject = test ? "[Prueba] " + issue.subject() : issue.subject();
        return new OutgoingEmail(to, subject, out.html(), out.text(), headers);
    }

    // The ItbaNews page that calls POST /v1/digests/unsubscribe. A preview
    // without a reader gets a link that does nothing.
    String unsubscribePageUrl(UUID readerId) {
        String token = readerId == null ? "preview" : tokens.issue(readerId);
        return props.publicBaseUrl() + "/unsubscribe?token=" + enc(token);
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    private static DigestContent.Org org(Organization o) {
        if (o == null) return null;
        String name = o.getName() != null && !o.getName().isBlank() ? o.getName() : o.getSlug();
        return new DigestContent.Org(o.getSlug(), name);
    }
}
