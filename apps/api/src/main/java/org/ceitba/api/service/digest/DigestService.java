package org.ceitba.api.service.digest;

import com.fasterxml.jackson.databind.JsonNode;
import org.ceitba.api.common.exception.ExternalApiException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.digest.DigestDelivery;
import org.ceitba.api.domain.digest.DigestIssue;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.digest.DigestDeliveryRepository;
import org.ceitba.api.repository.digest.DigestIssueRepository;
import org.ceitba.api.service.mail.EmailSendException;
import org.ceitba.api.service.mail.MailSenderNotConnectedException;
import org.ceitba.api.service.mail.MailQuotaExhaustedException;
import org.ceitba.api.service.mail.MailSendService;
import org.ceitba.api.service.news.FollowService;
import org.ceitba.api.web.digest.dto.DigestDtos;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

// Staff-facing lifecycle of the weekly digest (docs/WEEKLY-DIGEST.md):
// create/edit/preview/test/send/cancel, the scheduled draft and auto-send,
// and the per-user subscription. Sending itself is DigestSender's job.
@Service
public class DigestService {

    private static final Logger log = LoggerFactory.getLogger(DigestService.class);

    // A draft whose auto-send time passed longer ago than this (e.g. the API
    // was down for days) is left for staff instead of sending stale news.
    static final Duration AUTO_SEND_GRACE = Duration.ofHours(24);
    // Auto-send of the scheduled draft: Monday 12:00 ART.
    static final LocalTime AUTO_SEND_TIME = LocalTime.NOON;
    // The weekly draft is created from Monday 00:05 ART (the cron, or the
    // catch-up after downtime) until Tuesday 00:00: later in the week a
    // missing draft was deleted/cancelled on purpose and must stay that way.
    static final LocalTime DRAFT_FROM = LocalTime.of(0, 5);

    // Published after the send has been snapshotted and committed: the
    // sending worker picks it up (scheduling/DigestJob).
    public record SendRequested(UUID issueId) {}

    private final DigestIssueRepository issues;
    private final DigestDeliveryRepository deliveries;
    private final UserRepository users;
    private final DigestComposer composer;
    private final DigestUnsubscribeTokens tokens;
    private final MailSendService sender;
    private final DigestTrackingService tracking;
    private final FollowService follows;
    private final DigestProperties props;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public DigestService(DigestIssueRepository issues, DigestDeliveryRepository deliveries, UserRepository users,
                         DigestComposer composer, DigestUnsubscribeTokens tokens, MailSendService sender,
                         DigestTrackingService tracking, FollowService follows, DigestProperties props,
                         ApplicationEventPublisher events,
                         Clock clock) {
        this.issues = issues;
        this.deliveries = deliveries;
        this.users = users;
        this.composer = composer;
        this.tokens = tokens;
        this.sender = sender;
        this.tracking = tracking;
        this.follows = follows;
        this.props = props;
        this.events = events;
        this.clock = clock;
    }

    // ------------------------------------------------------------ reads

    @Transactional(readOnly = true)
    public List<DigestDtos.Summary> list() {
        var all = issues.findAllByOrderByWeekStartDesc();
        var ids = all.stream().map(DigestIssue::getId).toList();
        var counts = counts(ids);
        var engagement = tracking.engagement(ids);
        var progress = sendingProgress();
        return all.stream().map(i -> {
            var e = engagement.getOrDefault(i.getId(), DigestTrackingService.Engagement.ZERO);
            var p = progress.get(i.getId());
            return new DigestDtos.Summary(i.getId(), i.getWeekStart(), i.getWeekStart().plusDays(6),
                i.getSubject(), i.getStatus(), i.getAutoSendAt(), i.getSentAt(), i.getCreatedAt(),
                counts.getOrDefault(i.getId(), DigestDtos.Counts.ZERO),
                p == null ? null : p.resumeAt(), p == null ? null : p.estimatedFinishAt(),
                e.openRate(), e.clickRate());
        }).toList();
    }

    // The sending account's rolling 24h quota.
    @Transactional(readOnly = true)
    public DigestDtos.Quota quota() {
        var q = sender.status();
        return new DigestDtos.Quota(q.account(), q.limit(), q.usedLast24h(), q.remaining(),
            odt(q.pausedUntil()), q.pauseReason(), odt(q.nextCapacityAt()), null);
    }

    // Aggregate open/click stats of an issue (never per person).
    @Transactional(readOnly = true)
    public DigestDtos.Stats stats(UUID id) {
        load(id);
        return tracking.stats(id);
    }

    @Transactional(readOnly = true)
    public DigestDtos.Detail detail(UUID id) {
        return detail(load(id));
    }

    // Rendered as the caller would receive it (their unsubscribe link and
    // personal section, if any).
    @Transactional(readOnly = true)
    public String previewHtml(UUID id, UUID viewerId) {
        var issue = DigestComposer.Issue.of(load(id));
        return composer.render(issue, composer.template(issue, composer.content(issue)), viewerId).html();
    }

    // ------------------------------------------------------------ writes

    @Transactional
    public DigestDtos.Detail create(java.time.LocalDate weekStart, String autoSendAt) {
        var week = new DigestWeek(weekStart);
        OffsetDateTime auto = autoSendAt == null ? null : parseInstant(autoSendAt);
        if (auto != null) requireFuture(auto);
        if (issues.existsByWeekStart(weekStart)) {
            throw new DigestException(DigestException.Reason.DIGEST_EXISTS,
                "A digest for the week of " + weekStart + " already exists");
        }
        var issue = new DigestIssue(UUID.randomUUID(), weekStart, week.defaultSubject());
        issue.setAutoSendAt(auto);
        try {
            issues.saveAndFlush(issue);
        } catch (DataIntegrityViolationException race) {
            throw new DigestException(DigestException.Reason.DIGEST_EXISTS,
                "A digest for the week of " + weekStart + " already exists");
        }
        return detail(issue);
    }

    @Transactional
    public DigestDtos.Detail patch(UUID id, DigestDtos.PatchRequest req) {
        var issue = loadForUpdate(id);
        requireDraft(issue);
        if (req.subject() != null) {
            if (req.subject().isBlank()) throw new ValidationException("subject", req.subject(), "must not be blank");
            issue.setSubject(req.subject().strip());
        }
        if (req.intro() != null) {
            if (req.intro().isNull()) {
                issue.setIntro(null);
            } else if (req.intro().isTextual()) {
                String intro = req.intro().asText();
                if (intro.length() > 5000) throw new ValidationException("intro", "(long)", "at most 5000 characters");
                issue.setIntro(intro.isBlank() ? null : intro.strip());
            } else {
                throw new ValidationException("intro", req.intro(), "must be a string or null");
            }
        }
        if (req.excludedArticleIds() != null) issue.setExcludedArticleIds(cleanIds(req.excludedArticleIds()));
        if (req.excludedEventIds() != null) issue.setExcludedEventIds(cleanIds(req.excludedEventIds()));
        if (req.autoSendAt() != null) {
            var at = parseInstant(req.autoSendAt());
            // Saving the form resends the stored value: only a changed time
            // has to be in the future.
            if (at != null && !at.toInstant().equals(
                    issue.getAutoSendAt() == null ? null : issue.getAutoSendAt().toInstant())) {
                requireFuture(at);
            }
            issue.setAutoSendAt(at);
        }
        issues.flush();
        return detail(issue);
    }

    // Sends the `me` rendering to the caller now. Ignores their opt-out, never
    // the domain guard. Any status. Consumes sending quota (429
    // MAIL_QUOTA_EXHAUSTED when there is none) and is not tracked.
    @Transactional(readOnly = true)
    public String sendTest(UUID id, UUID userId) {
        requireMailEnabled();
        var user = users.findById(userId).orElseThrow(() -> new ResourceNotFoundException("User", userId.toString()));
        if (!props.isAllowedRecipient(user.getEmail())) {
            throw new DigestException(DigestException.Reason.EMAIL_NOT_ALLOWED,
                "Digest emails only go to " + String.join(", ", props.allowedDomains()) + " addresses");
        }
        var issue = DigestComposer.Issue.of(load(id));
        var template = composer.template(issue, composer.content(issue));
        String to = user.getEmail().trim();
        try {
            sender.send(composer.email(issue, template, userId, to, true));
        } catch (MailSenderNotConnectedException e) {
            throw e;   // 409 MAIL_SENDER_NOT_CONNECTED (GlobalExceptionHandler)
        } catch (EmailSendException e) {
            // Gmail's own daily limit: the account is now paused, same 429.
            if (e.kind() == EmailSendException.Kind.QUOTA) {
                throw new MailQuotaExhaustedException(sender.account(),
                    sender.readyAt().orElse(clock.instant().plus(MailSendService.WINDOW)));
            }
            throw new ExternalApiException("mail", "test send", e);
        }
        return to;
    }

    // draft -> sending: snapshot the recipients (pending deliveries); the
    // worker sends after commit. An issue with nothing left to send is
    // refused (409 DIGEST_EMPTY).
    @Transactional
    public DigestDtos.Detail send(UUID id, UUID byUserId) {
        requireMailEnabled();
        var issue = loadForUpdate(id);
        requireDraft(issue);
        if (composer.content(DigestComposer.Issue.of(issue)).isEmpty()) {
            throw new DigestException(DigestException.Reason.DIGEST_EMPTY,
                "Nothing to send: every article and event of the week is excluded or there are none");
        }
        startSending(issue, byUserId);
        return detail(issue);
    }

    // draft|sending -> cancelled. Pending deliveries of a sending issue are
    // dropped; the sent ones stay. The row lock waits for an email being sent
    // right now (DigestSender holds a share lock on the issue while sending),
    // so nothing goes out after this commits.
    @Transactional
    public DigestDtos.Detail cancel(UUID id) {
        var issue = loadForUpdate(id);
        if (!issue.isDraft() && !DigestIssue.SENDING.equals(issue.getStatus())) {
            throw notEditable(issue);
        }
        if (DigestIssue.SENDING.equals(issue.getStatus())) {
            int dropped = deliveries.deleteAllPending(issue.getId());
            log.info("Digest {}: sending stopped, {} pending deliveries dropped", issue.getWeekStart(), dropped);
        }
        issue.setStatus(DigestIssue.CANCELLED);
        issues.flush();
        return detail(issue);
    }

    // Removes the issue for good, in any status but sending (stop it first).
    // Its deliveries and tracking rows go with it (ON DELETE CASCADE), so its
    // stats are gone too. The row lock waits for an email being sent right now.
    // Deleting the scheduled draft of the current week inside the draft window
    // lets the job recreate it; cancel it instead to keep it from coming back.
    @Transactional
    public void delete(UUID id) {
        var issue = loadForUpdate(id);
        if (DigestIssue.SENDING.equals(issue.getStatus())) {
            throw new DigestException(DigestException.Reason.DIGEST_SENDING,
                "Digest is sending: stop the send before deleting it");
        }
        issues.delete(issue);
        issues.flush();
        log.info("Digest {} ({}) deleted", issue.getWeekStart(), issue.getStatus());
    }

    // ------------------------------------------------------------ jobs

    // The draft for the week that just ended, auto-sent Monday 12:00 ART.
    // Called by the Monday 00:05 cron and, as a catch-up for downtime, by the
    // tick and at startup: it only acts from Monday 00:05 ART until Tuesday
    // 00:00 ART, and is idempotent (week_start is unique). A draft created
    // after 12:00 gets no auto-send time (staff review and send it), instead
    // of going out unreviewed the moment it appears.
    @Transactional
    public Optional<UUID> createScheduledDraft() {
        var now = OffsetDateTime.now(clock).atZoneSameInstant(ClockConfig.ZONE);
        if (now.getDayOfWeek() != java.time.DayOfWeek.MONDAY || now.toLocalTime().isBefore(DRAFT_FROM)) {
            return Optional.empty();
        }
        var week = DigestWeek.previousWeek(now.toLocalDate());
        if (issues.existsByWeekStart(week.weekStart())) return Optional.empty();
        var issue = new DigestIssue(UUID.randomUUID(), week.weekStart(), week.defaultSubject());
        var autoSend = week.eventsFrom().atTime(AUTO_SEND_TIME).atZone(ClockConfig.ZONE).toOffsetDateTime();
        issue.setAutoSendAt(autoSend.isAfter(now.toOffsetDateTime()) ? autoSend : null);
        issues.saveAndFlush(issue);
        log.info("Digest draft created for the week of {} (auto-send {})", week.weekStart(), issue.getAutoSendAt());
        return Optional.of(issue.getId());
    }

    // Drafts whose auto-send time has come. Returns the ids that started. A
    // due draft with nothing to send is cancelled (and logged) instead. With
    // mail disabled nothing starts (logged): the draft stays for later.
    @Transactional
    public List<UUID> startDueAutoSends() {
        var now = OffsetDateTime.now(clock);
        var due = issues.findDueForAutoSend(now, now.minus(AUTO_SEND_GRACE));
        if (due.isEmpty()) return List.of();
        if (!sender.enabled()) {
            log.warn("Digest auto-send skipped: mail is disabled (MAIL_ENABLED=false), {} draft(s) due", due.size());
            return List.of();
        }
        var started = new java.util.ArrayList<UUID>();
        for (UUID id : due) {
            var issue = issues.findByIdForUpdate(id).orElse(null);
            if (issue == null || !issue.isDraft() || issue.getAutoSendAt() == null
                    || issue.getAutoSendAt().isAfter(now)) continue;
            if (composer.content(DigestComposer.Issue.of(issue)).isEmpty()) {
                issue.setStatus(DigestIssue.CANCELLED);
                log.info("Digest {}: nothing to send at auto-send time, cancelled", issue.getWeekStart());
                continue;
            }
            startSending(issue, null);
            started.add(id);
        }
        return started;
    }

    // ------------------------------------------------------------ subscription

    // What the digest does for this user: the flag AND following CEITBA (the
    // audience is CEITBA's followers who did not opt out).
    @Transactional(readOnly = true)
    public boolean isSubscribed(UUID userId) {
        return users.findById(userId).map(User::isDigestEmailEnabled).orElse(false)
            && follows.isFollowing(userId, DigestComposer.AUDIENCE_ORG);
    }

    // true: sets the flag and follows CEITBA (idempotent). false: only clears
    // the flag; other follows (and push) are untouched.
    @Transactional
    public boolean setSubscribed(UUID userId, boolean enabled) {
        users.setDigestEmailEnabled(userId, enabled);
        if (enabled) follows.followIfMissing(userId, DigestComposer.AUDIENCE_ORG);
        return isSubscribed(userId);
    }

    // Public one-click unsubscribe. Idempotent; a valid token of a deleted
    // user is a no-op.
    @Transactional
    public void unsubscribe(String token) {
        UUID userId = tokens.verify(token).orElseThrow(() ->
            new DigestException(DigestException.Reason.INVALID_TOKEN, "Invalid unsubscribe token"));
        users.setDigestEmailEnabled(userId, false);
    }

    // ------------------------------------------------------------ helpers

    private void startSending(DigestIssue issue, UUID byUserId) {
        var recipients = composer.recipients();
        deliveries.saveAll(recipients.stream()
            .map(r -> new DigestDelivery(issue.getId(), r.userId(), r.email()))
            .toList());
        issue.setStatus(DigestIssue.SENDING);
        issue.setSentBy(byUserId);
        issues.flush();
        log.info("Digest {}: sending to {} recipients", issue.getWeekStart(), recipients.size());
        events.publishEvent(new SendRequested(issue.getId()));
    }

    private DigestDtos.Detail detail(DigestIssue i) {
        var issue = DigestComposer.Issue.of(i);
        var candidates = composer.candidates(issue.week());
        Set<String> exA = Set.copyOf(issue.excludedArticleIds());
        Set<String> exE = Set.copyOf(issue.excludedEventIds());
        var articles = candidates.articles().stream().map(a -> new DigestDtos.ArticleItem(a.id(), a.title(),
            a.excerpt(), a.coverImage(), a.publishedAt(), ref(a.organization()), exA.contains(a.id()))).toList();
        var evts = candidates.events().stream().map(e -> new DigestDtos.EventItem(e.id(), e.title(), e.eventDate(),
            e.startTime(), e.endTime(), e.location(), ref(e.organization()), exE.contains(e.id()))).toList();
        Long estimate = i.isDraft() ? composer.recipientCount() : null;
        var p = DigestIssue.SENDING.equals(i.getStatus()) ? sendingProgress().get(i.getId()) : null;
        return new DigestDtos.Detail(i.getId(), i.getWeekStart(), i.getWeekStart().plusDays(6), i.getSubject(),
            i.getIntro(), i.getStatus(), i.getAutoSendAt(), i.getSentAt(),
            counts(List.of(i.getId())).getOrDefault(i.getId(), DigestDtos.Counts.ZERO),
            estimate, articles, evts,
            p == null ? null : p.resumeAt(), p == null ? null : p.estimatedFinishAt());
    }

    record Progress(OffsetDateTime resumeAt, OffsetDateTime estimatedFinishAt) {}

    // For each sending issue: when the paused account resumes (null = not
    // paused) and when its last email should go out. The worker sends the
    // issues in order (oldest week first), so each estimate includes the
    // pending emails of the issues before it.
    private Map<UUID, Progress> sendingProgress() {
        var sendingIds = issues.findSendingIds();
        if (sendingIds.isEmpty()) return Map.of();
        var pending = counts(sendingIds);
        var resumeAt = odt(sender.readyAt().orElse(null));
        var out = new HashMap<UUID, Progress>();
        long cumulative = 0;
        for (UUID id : sendingIds) {
            cumulative += pending.getOrDefault(id, DigestDtos.Counts.ZERO).pending();
            out.put(id, new Progress(resumeAt, odt(sender.estimateFinish(cumulative, props.sendInterval()))));
        }
        return out;
    }

    private static OffsetDateTime odt(java.time.Instant i) {
        return i == null ? null : i.atZone(ClockConfig.ZONE).toOffsetDateTime();
    }

    private Map<UUID, DigestDtos.Counts> counts(List<UUID> ids) {
        if (ids.isEmpty()) return Map.of();
        Map<UUID, long[]> acc = new HashMap<>();
        for (Object[] row : deliveries.countByIssueAndStatus(ids)) {
            long[] c = acc.computeIfAbsent((UUID) row[0], k -> new long[3]);
            long n = ((Number) row[2]).longValue();
            switch ((String) row[1]) {
                // `sending` (claimed, not finished) still counts as not done.
                case DigestDelivery.PENDING, DigestDelivery.SENDING -> c[0] += n;
                case DigestDelivery.SENT -> c[1] += n;
                case DigestDelivery.FAILED -> c[2] += n;
                default -> { }
            }
        }
        Map<UUID, DigestDtos.Counts> out = new HashMap<>();
        acc.forEach((k, c) -> out.put(k, new DigestDtos.Counts(c[0], c[1], c[2])));
        return out;
    }

    private static DigestDtos.OrgRef ref(DigestContent.Org o) {
        return o == null ? null : new DigestDtos.OrgRef(o.slug(), o.name());
    }

    private void requireMailEnabled() {
        if (!sender.enabled()) {
            throw new DigestException(DigestException.Reason.MAIL_DISABLED,
                "Email sending is disabled on this server (MAIL_ENABLED=false)");
        }
    }

    private void requireFuture(OffsetDateTime at) {
        if (at.isBefore(OffsetDateTime.now(clock))) {
            throw new DigestException(DigestException.Reason.AUTO_SEND_IN_PAST,
                "autoSendAt must be in the future");
        }
    }

    private DigestIssue load(UUID id) {
        return issues.findById(id).orElseThrow(() -> new ResourceNotFoundException("Digest", id.toString()));
    }

    private DigestIssue loadForUpdate(UUID id) {
        return issues.findByIdForUpdate(id).orElseThrow(() -> new ResourceNotFoundException("Digest", id.toString()));
    }

    private static void requireDraft(DigestIssue issue) {
        if (!issue.isDraft()) throw notEditable(issue);
    }

    private static DigestException notEditable(DigestIssue issue) {
        return new DigestException(DigestException.Reason.DIGEST_NOT_EDITABLE,
            "Digest is " + issue.getStatus() + ", not editable");
    }

    static List<String> cleanIds(List<String> ids) {
        var set = new LinkedHashSet<String>();
        for (String s : ids) {
            if (s != null && !s.isBlank()) set.add(s.strip());
        }
        return List.copyOf(set);
    }

    static OffsetDateTime parseInstant(JsonNode node) {
        if (node.isNull()) return null;
        if (!node.isTextual()) throw new ValidationException("autoSendAt", node, "must be an ISO-8601 instant or null");
        return parseInstant(node.asText());
    }

    static OffsetDateTime parseInstant(String text) {
        try {
            return OffsetDateTime.parse(text);
        } catch (DateTimeParseException e) {
            throw new ValidationException("autoSendAt", text, "must be an ISO-8601 instant or null");
        }
    }
}
