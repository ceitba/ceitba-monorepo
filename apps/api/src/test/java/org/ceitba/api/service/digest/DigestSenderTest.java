package org.ceitba.api.service.digest;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.digest.DigestDelivery;
import org.ceitba.api.domain.digest.DigestIssue;
import org.ceitba.api.domain.news.Article;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.digest.DigestDeliveryRepository;
import org.ceitba.api.repository.digest.DigestIssueRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.service.crypto.ContentHmac;
import org.ceitba.api.service.mail.EmailSendException;
import org.ceitba.api.service.mail.EmailSender;
import org.ceitba.api.service.mail.OutgoingEmail;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// The batch: throttling, rolling daily quota, failure handling, at-most-once
// claiming, resume and stop-on-cancel, with in-memory stand-ins for the
// delivery table.
class DigestSenderTest {

    static final UUID ISSUE = UUID.randomUUID();

    final DigestIssueRepository issues = mock(DigestIssueRepository.class);
    final DigestDeliveryRepository deliveries = mock(DigestDeliveryRepository.class);
    final UserRepository users = mock(UserRepository.class);
    final ArticleRepository articles = mock(ArticleRepository.class);
    final UserFollowRepository follows = mock(UserFollowRepository.class);

    // userId -> status ("pending" | "sending" | "sent" | "failed"); removed = dropped.
    final Map<UUID, String> rows = new java.util.LinkedHashMap<>();
    final Map<UUID, Integer> attempts = new HashMap<>();
    final Map<UUID, String> errors = new HashMap<>();
    final Map<UUID, String> emails = new HashMap<>();
    final List<String> sentTo = new ArrayList<>();
    final AtomicInteger sleeps = new AtomicInteger();
    Function<String, RuntimeException> failure = to -> null;
    String issueStatus = DigestIssue.SENDING;
    long attemptsLast24h = 0;

    DigestSender sender(int dailyLimit) {
        var props = new DigestProperties(null, null, null, dailyLimit, Duration.ofMillis(1), null, false);
        var tokens = new DigestUnsubscribeTokens(ContentHmac.fromJwtSecret("dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch"));
        var composer = new DigestComposer(articles, mock(NewsEventRepository.class), follows, users, tokens,
            (reader, issue) -> Optional.empty(), props);
        EmailSender mail = (OutgoingEmail e) -> {
            var ex = failure.apply(e.to());
            if (ex != null) throw ex;
            sentTo.add(e.to());
        };
        return new DigestSender(issues, deliveries, composer, mail, props,
            mock(PlatformTransactionManager.class), Clock.fixed(Instant.parse("2026-10-05T15:00:00Z"), ZoneOffset.UTC),
            d -> sleeps.incrementAndGet());
    }

    @BeforeEach
    void setUp() {
        var issue = new DigestIssue(ISSUE, LocalDate.of(2026, 9, 28), "Asunto");
        issue.setStatus(DigestIssue.SENDING);
        when(issues.findById(ISSUE)).thenReturn(Optional.of(issue));
        when(issues.findSendingIds()).thenAnswer(i -> DigestIssue.SENDING.equals(issueStatus) ? List.of(ISSUE) : List.of());
        when(issues.findStatusForShare(ISSUE)).thenAnswer(i -> Optional.of(issueStatus));
        when(issues.markSentIfDone(eq(ISSUE), any())).thenAnswer(i -> rows.containsValue("pending") ? 0 : 1);

        when(follows.existsByUserIdAndOrganization(any(), eq("ceitba"))).thenReturn(true);
        // One article: the issue is not empty.
        var a = new Article("a1", "Título", "Resumen", List.of("p"), "general", List.of("x"));
        a.setPublishedAt(LocalDate.of(2026, 9, 30));
        when(articles.findPublishedBetween(any(), any())).thenReturn(List.of(a));

        when(deliveries.countAttemptsSince(any())).thenAnswer(i -> attemptsLast24h);
        // Like the claim query: fresh rows first (attempts, then insertion order).
        when(deliveries.lockNextPending(eq(ISSUE), any())).thenAnswer(i -> rows.entrySet().stream()
            .filter(e -> e.getValue().equals("pending"))
            .min(java.util.Comparator.comparingInt(e -> attempts.getOrDefault(e.getKey(), 0)))
            .map(e -> {
                var d = new DigestDelivery(ISSUE, e.getKey(), emails.get(e.getKey()));
                ReflectionTestUtils.setField(d, "attempts", attempts.getOrDefault(e.getKey(), 0));
                return d;
            }));
        when(deliveries.markSending(eq(ISSUE), any(), any())).thenAnswer(i -> move(i.getArgument(1), "pending", "sending"));
        when(deliveries.markSent(eq(ISSUE), any(), any())).thenAnswer(i -> move(i.getArgument(1), "sending", "sent"));
        when(deliveries.markFailed(eq(ISSUE), any(), any(), any())).thenAnswer(i -> {
            errors.put(i.getArgument(1), i.getArgument(3));
            return move(i.getArgument(1), "sending", "failed");
        });
        when(deliveries.retryLater(eq(ISSUE), any(), any())).thenAnswer(i -> {
            attempts.merge(i.getArgument(1), 1, Integer::sum);
            return move(i.getArgument(1), "sending", "pending");
        });
        when(deliveries.release(eq(ISSUE), any(), any())).thenAnswer(i -> move(i.getArgument(1), "sending", "pending"));
        when(deliveries.deleteClaimed(eq(ISSUE), any())).thenAnswer(i ->
            "sending".equals(rows.get((UUID) i.getArgument(1))) && rows.remove((UUID) i.getArgument(1)) != null ? 1 : 0);
    }

    int move(UUID userId, String from, String to) {
        if (!from.equals(rows.get(userId))) return 0;
        rows.put(userId, to);
        return 1;
    }

    UUID recipient(String email) {
        return recipient(email, true);
    }

    UUID recipient(String email, boolean enabled) {
        var u = new User(UUID.randomUUID(), email, "N");
        u.setDigestEmailEnabled(enabled);
        when(users.findById(u.getId())).thenReturn(Optional.of(u));
        rows.put(u.getId(), "pending");
        emails.put(u.getId(), email);
        return u.getId();
    }

    @Test
    void sendsEveryPendingThrottledThenMarksIssueSent() {
        recipient("a@itba.edu.ar");
        recipient("b@itba.edu.ar");
        recipient("c@itba.edu.ar");

        sender(1500).runPending();

        assertThat(sentTo).containsExactly("a@itba.edu.ar", "b@itba.edu.ar", "c@itba.edu.ar");
        assertThat(rows.values()).containsOnly("sent");
        assertThat(sleeps.get()).isEqualTo(3);
        verify(issues).markSentIfDone(eq(ISSUE), any());
    }

    @Test
    void dailyQuotaStopsTheRunAndALaterRunResumes() {
        for (int i = 0; i < 5; i++) recipient("u" + i + "@itba.edu.ar");
        attemptsLast24h = 7;   // 10 - 7 = 3 left today

        var s = sender(10);
        s.runPending();
        assertThat(sentTo).hasSize(3);
        assertThat(rows.values()).filteredOn("pending"::equals).hasSize(2);

        attemptsLast24h = 0;   // a day later
        s.runPending();
        assertThat(sentTo).hasSize(5).doesNotHaveDuplicates();
        assertThat(rows.values()).containsOnly("sent");
    }

    @Test
    void recipientFailureIsRecordedAndTheRunGoesOn() {
        recipient("a@itba.edu.ar");
        var bad = recipient("bad@itba.edu.ar");
        recipient("c@itba.edu.ar");
        failure = to -> to.startsWith("bad")
            ? new EmailSendException(EmailSendException.Kind.RECIPIENT, "550 no such user", null) : null;

        sender(1500).runPending();

        assertThat(sentTo).containsExactly("a@itba.edu.ar", "c@itba.edu.ar");
        assertThat(rows.get(bad)).isEqualTo("failed");
        verify(deliveries).markFailed(eq(ISSUE), eq(bad), any(), eq("550 no such user"));
    }

    @Test
    void transportFailureStopsWithoutBlamingTheRow() {
        var a = recipient("a@itba.edu.ar");
        recipient("b@itba.edu.ar");
        failure = to -> new EmailSendException(EmailSendException.Kind.TRANSPORT, "535 5.7.8 bad credentials", null);

        sender(1500).runPending();

        assertThat(sentTo).isEmpty();
        assertThat(rows.get(a)).isEqualTo("pending");
        assertThat(attempts).doesNotContainKey(a);
        verify(deliveries, never()).markFailed(any(), any(), any(), any());

        failure = to -> null;   // SMTP back: the next tick resumes
        sender(1500).runPending();
        assertThat(sentTo).hasSize(2);
    }

    @Test
    void temporaryFailureOfOneRecipientNeverStallsTheIssueAndFailsAfterThreeAttempts() {
        var bad = recipient("bad@itba.edu.ar");
        recipient("b@itba.edu.ar");
        recipient("c@itba.edu.ar");
        failure = to -> to.startsWith("bad")
            ? new EmailSendException(EmailSendException.Kind.TRANSIENT, "451 4.3.0 try later", null) : null;

        sender(1500).runPending();

        // Everyone else was served; the bad one was tried 3 times, then given up.
        assertThat(sentTo).containsExactly("b@itba.edu.ar", "c@itba.edu.ar");
        assertThat(rows.get(bad)).isEqualTo("failed");
        assertThat(attempts.get(bad)).isEqualTo(2);   // two retries, the third failure is final
        assertThat(errors.get(bad)).startsWith("gave up after 3 attempts").contains("451 4.3.0");
        verify(deliveries, times(2)).retryLater(eq(ISSUE), eq(bad), any());
        verify(issues).markSentIfDone(eq(ISSUE), any());
    }

    @Test
    void rowsLeftSendingByACrashAreFailedNeverResent() {
        var interrupted = recipient("lost@itba.edu.ar");
        rows.put(interrupted, "sending");   // claimed before the crash, outcome unknown
        recipient("ok@itba.edu.ar");
        when(deliveries.failStale(any(), any())).thenAnswer(i -> {
            rows.replaceAll((k, v) -> v.equals("sending") ? "failed" : v);
            return 1;
        });

        sender(1500).runPending();

        // Cutoff is 5 minutes before "now" (15:00Z), reason is recorded as unknown.
        verify(deliveries).failStale(Instant.parse("2026-10-05T14:55:00Z").atOffset(ZoneOffset.UTC),
            "unknown outcome (interrupted)");
        assertThat(rows.get(interrupted)).isEqualTo("failed");
        assertThat(sentTo).containsExactly("ok@itba.edu.ar");   // lost@ is not resent
    }

    @Test
    void cancelMidwayStopsBeforeTheNextEmail() {
        recipient("a@itba.edu.ar");
        recipient("b@itba.edu.ar");
        recipient("c@itba.edu.ar");
        // Staff press "Detener envío" while the first email is going out.
        failure = to -> {
            issueStatus = DigestIssue.CANCELLED;
            return null;
        };

        sender(1500).runPending();

        assertThat(sentTo).containsExactly("a@itba.edu.ar");
        verify(issues, never()).markSentIfDone(any(), any());
    }

    @Test
    void dropsRecipientsThatNoLongerQualify() {
        var off = recipient("off@itba.edu.ar", false);
        var foreign = recipient("x@gmail.com");
        var unfollowed = recipient("gone@itba.edu.ar");
        when(follows.existsByUserIdAndOrganization(unfollowed, "ceitba")).thenReturn(false);
        recipient("ok@itba.edu.ar");

        sender(1500).runPending();

        assertThat(sentTo).containsExactly("ok@itba.edu.ar");
        assertThat(rows).doesNotContainKeys(off, foreign, unfollowed);
    }

    @Test
    void everyEmailCarriesItsOwnUnsubscribeHeaders() {
        var ids = List.of(recipient("a@itba.edu.ar"), recipient("b@itba.edu.ar"));
        var captured = new ArrayList<OutgoingEmail>();
        var props = new DigestProperties(null, null, null, 1500, Duration.ZERO, null, false);
        var tokens = new DigestUnsubscribeTokens(ContentHmac.fromJwtSecret("dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch"));
        var composer = new DigestComposer(articles, mock(NewsEventRepository.class), follows, users, tokens,
            (reader, issue) -> Optional.empty(), props);
        new DigestSender(issues, deliveries, composer, captured::add, props, mock(PlatformTransactionManager.class),
            Clock.systemUTC(), d -> { }).runPending();

        assertThat(captured).hasSize(2);
        for (int i = 0; i < 2; i++) {
            var mail = captured.get(i);
            String token = tokens.issue(ids.get(i));
            assertThat(mail.headers().get("List-Unsubscribe"))
                .isEqualTo("<https://ceitba.org.ar/api/v1/digests/unsubscribe?token=" + token + ">");
            assertThat(mail.headers()).containsEntry("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
            assertThat(mail.html()).contains("https://ceitba.org.ar/newsletter/unsubscribe?token=" + token);
        }
    }
}
