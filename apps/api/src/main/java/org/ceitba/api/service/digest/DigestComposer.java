package org.ceitba.api.service.digest;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.digest.DigestIssue;
import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.service.capability.Capability;
import org.ceitba.api.service.capability.CapabilityService;
import org.ceitba.api.service.mail.OutgoingEmail;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.net.URLEncoder;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// Builds an issue's email: the shared content (same for every recipient,
// rendered once), the audience, and per recipient only the unsubscribe link
// and the DigestPersonalSection ("Tu cuatrimestre"). Shared by DigestService (previews,
// test sends, recipient snapshot) and DigestSender (the batch).
@Component
public class DigestComposer {

    private static final Logger log = LoggerFactory.getLogger(DigestComposer.class);

    // The digest is CEITBA's email: its audience is CEITBA's followers
    // (every user follows it by default).
    public static final String AUDIENCE_ORG = "ceitba";

    // Kinds of the sending-quota ledger (mail_send_log.kind).
    public static final String KIND_DIGEST = OutgoingEmail.KIND_DIGEST;
    public static final String KIND_TEST = OutgoingEmail.KIND_TEST;

    // Entity-free copy of an issue's editable fields.
    public record Issue(UUID id, DigestWeek week, String subject, String intro,
                        List<String> excludedArticleIds, List<String> excludedEventIds) {

        static Issue of(DigestIssue i) {
            return new Issue(i.getId(), new DigestWeek(i.getWeekStart()), i.getSubject(), i.getIntro(),
                i.getExcludedArticleIds(), i.getExcludedEventIds());
        }
    }

    // Users per CapabilityService.holders call when snapshotting recipients.
    private static final int CAPABILITY_BATCH = 500;

    public record Recipient(UUID userId, String email) {}

    private final ArticleRepository articles;
    private final NewsEventRepository events;
    private final UserFollowRepository follows;
    private final UserRepository users;
    private final DigestUnsubscribeTokens tokens;
    private final DigestPersonalSection personalSection;
    private final DigestProperties props;
    private final CapabilityService capabilities;
    private final Clock clock;

    public DigestComposer(ArticleRepository articles, NewsEventRepository events, UserFollowRepository follows,
                          UserRepository users, DigestUnsubscribeTokens tokens,
                          DigestPersonalSection personalSection, DigestProperties props,
                          CapabilityService capabilities, Clock clock) {
        this.articles = articles;
        this.events = events;
        this.follows = follows;
        this.users = users;
        this.tokens = tokens;
        this.personalSection = personalSection;
        this.props = props;
        this.capabilities = capabilities;
        this.clock = clock;
    }

    // Every candidate of the week, before staff exclusions.
    @Transactional(readOnly = true)
    public DigestContent.Candidates candidates(DigestWeek week) {
        var a = articles.findPublishedBetween(week.weekStart(), week.weekEnd()).stream()
            .map(x -> new DigestContent.Article(x.getId(), x.getTitle(), x.getExcerpt(), x.getCoverImage(),
                x.getPublishedAt(), org(x.getOrganization())))
            .toList();
        var e = events.findDigestCandidates(week.eventsFrom(), week.eventsTo(),
                week.announcedFrom(), week.announcedTo()).stream()
            .map(x -> new DigestContent.Event(x.getId(), x.getTitle(), x.getEventDate(), x.getStartTime(),
                x.getEndTime(), x.getLocation(), org(x.getOrganization()),
                !NewsEvent.SIGNUP_NONE.equals(x.getSignupMode())))
            .toList();
        return new DigestContent.Candidates(week, a, e);
    }

    // What every recipient gets.
    @Transactional(readOnly = true)
    public DigestContent.Shared content(Issue issue) {
        return DigestSelection.included(candidates(issue.week()),
            issue.excludedArticleIds(), issue.excludedEventIds());
    }

    // Followers of CEITBA with the digest enabled, an allowed-domain email and
    // the resumen_semanal capability (checked per batch, not per user).
    @Transactional(readOnly = true)
    public List<Recipient> recipients() {
        var allowed = users.findDigestAudience(AUDIENCE_ORG).stream()
            .filter(u -> props.isAllowedRecipient(u.getEmail()))
            .toList();
        var out = new ArrayList<Recipient>();
        for (int i = 0; i < allowed.size(); i += CAPABILITY_BATCH) {
            var batch = allowed.subList(i, Math.min(i + CAPABILITY_BATCH, allowed.size()));
            var holders = capabilities.holders(Capability.RESUMEN_SEMANAL, batch);
            for (var u : batch) {
                if (holders.contains(u.getId())) out.add(new Recipient(u.getId(), u.getEmail().trim()));
            }
        }
        return out;
    }

    // Size of recipients() without loading the users (the draft's estimate).
    @Transactional(readOnly = true)
    public long recipientCount() {
        return users.countDigestAudienceWithCapability(AUDIENCE_ORG, props.allowedDomains(),
            Capability.RESUMEN_SEMANAL.key(), OffsetDateTime.now(clock));
    }

    // Re-checked right before sending to a snapshotted recipient.
    @Transactional(readOnly = true)
    public boolean stillEligible(UUID userId, String email) {
        User u = users.findById(userId).orElse(null);
        return u != null && u.isDigestEmailEnabled() && props.isAllowedRecipient(email)
            && follows.existsByUserIdAndOrganization(userId, AUDIENCE_ORG)
            && capabilities.has(u, Capability.RESUMEN_SEMANAL);
    }

    public DigestRenderer.Template template(Issue issue, DigestContent.Shared content) {
        return DigestRenderer.template(new DigestRenderer.Input(issue.subject(), issue.week(), issue.intro(),
            content, props.publicBaseUrl()));
    }

    // readerId null = a preview without a reader (inert unsubscribe link).
    public DigestRenderer.Output render(Issue issue, DigestRenderer.Template template, UUID readerId) {
        return render(template, readerId, personalSection(issue, readerId));
    }

    // With the reader's personal section already loaded (null = none).
    public DigestRenderer.Output render(DigestRenderer.Template template, UUID readerId,
                                        DigestPersonalSection.Section personal) {
        return template.forReader(personal, unsubscribePageUrl(readerId));
    }

    // The personal sections of a page of recipients, loaded together. A
    // failure only costs the personal block: the shared digest still goes out.
    public Map<UUID, DigestPersonalSection.Section> personalSections(Issue issue, Collection<UUID> readerIds) {
        if (readerIds.isEmpty()) return Map.of();
        try {
            return personalSection.forReaders(readerIds, issue);
        } catch (RuntimeException e) {
            log.warn("Digest {}: personal sections unavailable, sending without them: {}",
                issue.week().weekStart(), e.getMessage(), e);
            return Map.of();
        }
    }

    private DigestPersonalSection.Section personalSection(Issue issue, UUID readerId) {
        if (readerId == null) return null;
        return personalSections(issue, List.of(readerId)).get(readerId);
    }

    public OutgoingEmail email(Issue issue, DigestRenderer.Template template, UUID userId, String to, boolean test) {
        return email(issue, template, userId, to, test, personalSection(issue, userId));
    }

    public OutgoingEmail email(Issue issue, DigestRenderer.Template template, UUID userId, String to, boolean test,
                               DigestPersonalSection.Section personal) {
        var out = render(template, userId, personal);
        var headers = new LinkedHashMap<String, String>();
        // RFC 2369 + RFC 8058 one-click: mail clients POST to the API directly.
        headers.put("List-Unsubscribe",
            "<" + props.apiBaseUrl() + "/v1/digests/unsubscribe?token=" + enc(tokens.issue(userId)) + ">");
        headers.put("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
        headers.put("List-Id", "La semana en ITBA <digest.ceitba.org.ar>");
        if (!test) headers.put("Precedence", "bulk");
        String subject = test ? "[Prueba] " + issue.subject() : issue.subject();
        return new OutgoingEmail(to, subject, out.html(), out.text(), headers, test ? KIND_TEST : KIND_DIGEST);
    }

    // The ItbaNews page that calls POST /v1/digests/unsubscribe.
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
