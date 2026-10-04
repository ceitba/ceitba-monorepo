package org.ceitba.api.service.mail;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// The sending-quota ledger: rolling 24h window, resumeAt maths, Gmail's
// own daily-limit pause, transport backoff and overflow across days.
class MailSendServiceTest {

    static final String ACCOUNT = "ceitba@itba.edu.ar";
    static final Instant T0 = Instant.parse("2026-10-05T15:00:00Z");

    final InMemoryMailLedger ledger = new InMemoryMailLedger();
    final MutableClock clock = new MutableClock(T0);
    final List<String> sent = new ArrayList<>();
    Function<String, RuntimeException> failure = to -> null;

    MailSendService service(int limit) {
        EmailSender transport = email -> {
            var ex = failure.apply(email.to());
            if (ex != null) throw ex;
            sent.add(email.to());
        };
        return new MailSendService(transport, ledger, ACCOUNT, limit,
            Duration.ofMinutes(5), Duration.ofHours(1), Duration.ofHours(24), clock);
    }

    static OutgoingEmail mail(String to) {
        return new OutgoingEmail(to, "s", "<p>h</p>", "t", null, "digest");
    }

    @Test
    void everyAttemptIsLoggedWithAccountKindAndOutcome() {
        var s = service(10);
        s.send(mail("a@itba.edu.ar"));
        s.send(new OutgoingEmail("b@itba.edu.ar", "s", "h", "t", null, "test"));
        failure = to -> new EmailSendException(EmailSendException.Kind.RECIPIENT, "550 5.1.1 no such user", null);
        assertThatThrownBy(() -> s.send(mail("bad@itba.edu.ar"))).isInstanceOf(EmailSendException.class);

        assertThat(ledger.rows).extracting(InMemoryMailLedger.Row::kind).containsExactly("digest", "test", "digest");
        assertThat(ledger.rows).extracting(InMemoryMailLedger.Row::outcome).containsExactly(
            MailLedger.Outcome.SENT, MailLedger.Outcome.SENT, MailLedger.Outcome.REJECTED);
        assertThat(ledger.rows).allMatch(r -> r.account().equals(ACCOUNT) && r.recipients() == 1);
        // Rejected recipients reached Gmail: they count.
        assertThat(s.status().usedLast24h()).isEqualTo(3);
        assertThat(s.status().remaining()).isEqualTo(7);
    }

    @Test
    void rollingWindowRefusesWhenFullAndSaysWhenCapacityFrees() {
        // 3 at T0-20h, 2 at T0-10h: limit 5 is full.
        ledger.sent(ACCOUNT, T0.minus(Duration.ofHours(20)), 3);
        ledger.sent(ACCOUNT, T0.minus(Duration.ofHours(10)), 2);
        var s = service(5);

        var status = s.status();
        assertThat(status.usedLast24h()).isEqualTo(5);
        assertThat(status.remaining()).isZero();
        // The oldest attempt in the window + 24h.
        assertThat(status.nextCapacityAt()).isEqualTo(T0.plus(Duration.ofHours(4)));
        assertThat(s.readyAt()).contains(T0.plus(Duration.ofHours(4)));

        assertThatThrownBy(() -> s.send(mail("a@itba.edu.ar")))
            .isInstanceOfSatisfying(MailQuotaExhaustedException.class,
                e -> assertThat(e.resumeAt()).isEqualTo(T0.plus(Duration.ofHours(4))));
        assertThat(sent).isEmpty();
        // A refused send is not an attempt: nothing logged.
        assertThat(ledger.rows).hasSize(5);

        // 4h later the 3 oldest left the window.
        clock.advance(Duration.ofHours(4));
        assertThat(s.status().remaining()).isEqualTo(3);
        assertThat(s.status().nextCapacityAt()).isNull();
        assertThat(s.readyAt()).isEmpty();
        s.send(mail("a@itba.edu.ar"));
        assertThat(sent).containsExactly("a@itba.edu.ar");
    }

    @Test
    void overLimitNeedsSeveralOldAttemptsToExpire() {
        // Limit lowered below what was sent: 8 used, limit 5 -> 4 must leave.
        for (int h = 1; h <= 8; h++) ledger.sent(ACCOUNT, T0.minus(Duration.ofHours(24 - h)), 1);
        var s = service(5);
        assertThat(s.status().nextCapacityAt()).isEqualTo(T0.minus(Duration.ofHours(20)).plus(Duration.ofHours(24)));
    }

    @Test
    void overflowRollsIntoTheNextDay() {
        var s = service(3);
        var all = List.of("a", "b", "c", "d", "e", "f", "g");
        var queue = new ArrayList<>(all);
        Instant firstResume = null;
        // Day 1: three go out (one per minute), then the quota is used up.
        while (!queue.isEmpty()) {
            try {
                s.send(mail(queue.get(0)));
                queue.remove(0);
                clock.advance(Duration.ofMinutes(1));
            } catch (MailQuotaExhaustedException e) {
                if (firstResume == null) firstResume = e.resumeAt();
                // What the job does: nothing until resumeAt.
                clock.set(e.resumeAt());
            }
        }
        assertThat(sent).containsExactlyElementsOf(all);
        // The 4th waited until the first email's slot freed, 24h later.
        assertThat(firstResume).isEqualTo(T0.plus(Duration.ofHours(24)));
        // Never more than 3 in any 24h window.
        var times = ledger.rows.stream().map(InMemoryMailLedger.Row::at).toList();
        for (Instant t : times) {
            long inWindow = times.stream().filter(x -> !x.isBefore(t) && x.isBefore(t.plus(Duration.ofHours(24)))).count();
            assertThat(inWindow).isLessThanOrEqualTo(3);
        }
        // 7 emails at 3/day: the last one goes out on the third day.
        assertThat(times.get(6)).isAfterOrEqualTo(T0.plus(Duration.ofHours(48)));
    }

    @Test
    void gmailDailyLimitErrorPausesTheAccountForADayAndSurvivesARestart() {
        ledger.sent(ACCOUNT, T0.minus(Duration.ofHours(1)), 10);   // our count: 10 of 1500
        var s = service(1500);
        failure = to -> new EmailSendException(EmailSendException.Kind.QUOTA,
            "550 5.4.5 Daily user sending limit exceeded", null);

        assertThatThrownBy(() -> s.send(mail("a@itba.edu.ar"))).isInstanceOf(EmailSendException.class);
        assertThat(ledger.rows.get(ledger.rows.size() - 1).outcome()).isEqualTo(MailLedger.Outcome.QUOTA);
        // Gmail's error does not count as a send.
        assertThat(s.status().usedLast24h()).isEqualTo(10);

        Instant until = T0.plus(Duration.ofHours(24));
        assertThat(s.status().pausedUntil()).isEqualTo(until);
        assertThat(s.status().pauseReason()).isEqualTo("quota");

        // A restart (new service, same persisted ledger) is still paused, and
        // a manual (test) send is refused with the same resumeAt.
        failure = to -> null;
        var restarted = service(1500);
        assertThat(restarted.readyAt()).contains(until);
        assertThatThrownBy(() -> restarted.send(mail("staff@itba.edu.ar")))
            .isInstanceOfSatisfying(MailQuotaExhaustedException.class, e -> assertThat(e.resumeAt()).isEqualTo(until));
        assertThat(sent).isEmpty();

        clock.set(until);
        assertThat(restarted.readyAt()).isEmpty();
        restarted.send(mail("a@itba.edu.ar"));
        assertThat(sent).containsExactly("a@itba.edu.ar");
        assertThat(restarted.status().pausedUntil()).isNull();
    }

    @Test
    void gmailPauseLengthIsConfigurable() {
        var s = new MailSendService(email -> {
            throw new EmailSendException(EmailSendException.Kind.QUOTA, "550 5.4.5", null);
        }, ledger, ACCOUNT, 1500, Duration.ofMinutes(5), Duration.ofHours(1), Duration.ofHours(30), clock);
        assertThatThrownBy(() -> s.send(mail("a@itba.edu.ar"))).isInstanceOf(EmailSendException.class);
        assertThat(s.readyAt()).contains(T0.plus(Duration.ofHours(30)));
    }

    @Test
    void transportErrorsBackOffExponentiallyAndASuccessClearsIt() {
        var s = service(1500);
        failure = to -> new EmailSendException(EmailSendException.Kind.TRANSPORT, "421 4.7.0 Try again later", null);

        var expected = List.of(5L, 10L, 20L, 40L, 60L, 60L);
        for (long minutes : expected) {
            assertThatThrownBy(() -> s.send(mail("a@itba.edu.ar"))).isInstanceOf(EmailSendException.class);
            assertThat(s.readyAt()).contains(clock.instant().plus(Duration.ofMinutes(minutes)));
            assertThat(s.status().pauseReason()).isEqualTo("transport");
            clock.set(s.readyAt().orElseThrow());
        }
        // Transport errors never count against the quota.
        assertThat(s.status().usedLast24h()).isZero();
        assertThat(ledger.rows).allMatch(r -> r.outcome() == MailLedger.Outcome.TRANSIENT);

        // A manual send still tries during the backoff (to check SMTP is back).
        failure = to -> null;
        assertThatThrownBy(() -> {
            failure = to -> new EmailSendException(EmailSendException.Kind.TRANSPORT, "timeout", null);
            s.send(mail("a@itba.edu.ar"));
        }).isInstanceOf(EmailSendException.class);
        failure = to -> null;
        s.send(mail("staff@itba.edu.ar"));
        assertThat(sent).containsExactly("staff@itba.edu.ar");
        assertThat(s.readyAt()).isEmpty();
        assertThat(ledger.states.get(ACCOUNT).isClear()).isTrue();

        // The count starts over: the next error is 5 min again.
        failure = to -> new EmailSendException(EmailSendException.Kind.TRANSPORT, "timeout", null);
        assertThatThrownBy(() -> s.send(mail("a@itba.edu.ar"))).isInstanceOf(EmailSendException.class);
        assertThat(s.readyAt()).contains(clock.instant().plus(Duration.ofMinutes(5)));
    }

    @Test
    void aThrottleWithRetryAfterBacksOffShortlyNotTheExponentialStepNorTheDailyPause() {
        var s = service(1500);
        failure = to -> new EmailSendException(EmailSendException.Kind.TRANSPORT, "429", null, Duration.ofSeconds(30));
        assertThatThrownBy(() -> s.send(mail("a@itba.edu.ar"))).isInstanceOf(EmailSendException.class);
        assertThat(s.readyAt()).contains(clock.instant().plusSeconds(30));
        // A hint beyond the cap is capped at backoffMax.
        failure = to -> new EmailSendException(EmailSendException.Kind.TRANSPORT, "429", null, Duration.ofDays(1));
        assertThatThrownBy(() -> s.send(mail("a@itba.edu.ar"))).isInstanceOf(EmailSendException.class);
        assertThat(s.readyAt()).contains(clock.instant().plus(Duration.ofHours(1)));
    }

    @Test
    void aDeliveryScopedTemporaryErrorDoesNotPauseTheAccount() {
        var s = service(1500);
        failure = to -> new EmailSendException(EmailSendException.Kind.TRANSIENT, "451 4.3.0 try later", null);
        assertThatThrownBy(() -> s.send(mail("a@itba.edu.ar"))).isInstanceOf(EmailSendException.class);

        assertThat(s.readyAt()).isEmpty();
        assertThat(ledger.states.getOrDefault(ACCOUNT, MailLedger.State.CLEAR).isClear()).isTrue();
        assertThat(s.status().usedLast24h()).isZero();   // not counted
    }

    @Test
    void digestAndTestEmailsOutsideTheAllowedDomainsAreRefusedBeforeSending() {
        var s = new MailSendService(email -> sent.add(email.to()), ledger, ACCOUNT, 10,
            Duration.ofMinutes(5), Duration.ofHours(1), Duration.ofHours(24), clock,
            to -> to.endsWith("@itba.edu.ar"));

        for (String kind : List.of("digest", "test")) {
            assertThatThrownBy(() -> s.send(new OutgoingEmail("x@gmail.com", "s", "h", "t", null, kind)))
                .isInstanceOfSatisfying(EmailSendException.class,
                    e -> assertThat(e.kind()).isEqualTo(EmailSendException.Kind.RECIPIENT));
        }
        assertThat(sent).isEmpty();
        assertThat(ledger.rows).isEmpty();   // nothing sent, nothing counted

        s.send(new OutgoingEmail("ok@itba.edu.ar", "s", "h", "t", null, "digest"));
        assertThat(sent).containsExactly("ok@itba.edu.ar");
    }

    @Test
    void estimateFinishFollowsTheRollingWindow() {
        // Limit 3, 2 used 23h ago: 1 left now, 2 more free in 1h.
        ledger.sent(ACCOUNT, T0.minus(Duration.ofHours(23)), 2);
        var s = service(3);
        assertThat(s.estimateFinish(1, Duration.ofSeconds(1))).isEqualTo(T0);
        // 2nd waits until the 2 old ones leave (T0 + 1h), 3rd 1 s later.
        assertThat(s.estimateFinish(3, Duration.ofSeconds(1))).isEqualTo(T0.plus(Duration.ofHours(1)).plusSeconds(1));
        // 4th: the window then holds T0, T0+1h, T0+1h+1s -> waits for T0 + 24h.
        assertThat(s.estimateFinish(4, Duration.ofSeconds(1))).isEqualTo(T0.plus(Duration.ofHours(24)));
    }

    @Test
    void estimateFinishStartsAfterAPause() {
        var s = service(1500);
        ledger.states.put(ACCOUNT, new MailLedger.State(T0.plus(Duration.ofHours(2)), "quota", 0));
        assertThat(s.estimateFinish(3, Duration.ofSeconds(1))).isEqualTo(T0.plus(Duration.ofHours(2)).plusSeconds(2));
    }
}
