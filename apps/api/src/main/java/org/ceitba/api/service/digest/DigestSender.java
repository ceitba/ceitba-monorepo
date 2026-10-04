package org.ceitba.api.service.digest;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.digest.DigestDelivery;
import org.ceitba.api.domain.digest.DigestIssue;
import org.ceitba.api.repository.digest.DigestDeliveryRepository;
import org.ceitba.api.repository.digest.DigestIssueRepository;
import org.ceitba.api.service.mail.EmailSendException;
import org.ceitba.api.service.mail.EmailSender;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

// The sending worker (docs/WEEKLY-DIGEST.md). Walks the pending deliveries of
// every `sending` issue, one email at a time:
//   - each email is sent inside its own transaction that holds a share lock
//     on the issue row and re-checks that it is still `sending`; the
//     delivery is marked sent/failed in that same transaction. A cancel
//     (row lock) therefore waits for the email in flight and nothing is sent
//     after it; a crash leaves the row pending (resumed on the next run).
//   - throttled (digest.send-interval between emails)
//   - at most digest.daily-limit attempts per rolling 24h across issues;
//     when the quota is used up the run stops and a later tick resumes
//   - a pending recipient who unsubscribed/unfollowed CEITBA meanwhile is dropped
//   - a recipient problem marks that delivery failed and goes on; a
//     transport problem (auth, quota, connection) stops the run
//   - no pending row left: the issue becomes `sent`
// One run at a time per process (single API instance).
@Component
public class DigestSender {

    private static final Logger log = LoggerFactory.getLogger(DigestSender.class);
    private static final int PAGE = 50;
    private static final int MAX_ERROR_LENGTH = 1000;

    public interface Sleeper {
        void sleep(Duration d) throws InterruptedException;
    }

    public enum Outcome { DONE, STOPPED, CANCELLED }

    enum Step { SENT, FAILED, SKIPPED, TRANSIENT, CANCELLED }

    private final DigestIssueRepository issues;
    private final DigestDeliveryRepository deliveries;
    private final DigestComposer composer;
    private final EmailSender sender;
    private final DigestProperties props;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final Sleeper sleeper;
    private final AtomicBoolean running = new AtomicBoolean();

    @Autowired
    public DigestSender(DigestIssueRepository issues, DigestDeliveryRepository deliveries,
                        DigestComposer composer, EmailSender sender, DigestProperties props,
                        PlatformTransactionManager txManager, Clock clock) {
        this(issues, deliveries, composer, sender, props, txManager, clock, d -> Thread.sleep(d));
    }

    DigestSender(DigestIssueRepository issues, DigestDeliveryRepository deliveries,
                 DigestComposer composer, EmailSender sender, DigestProperties props,
                 PlatformTransactionManager txManager, Clock clock, Sleeper sleeper) {
        this.issues = issues;
        this.deliveries = deliveries;
        this.composer = composer;
        this.sender = sender;
        this.props = props;
        this.tx = new TransactionTemplate(txManager);
        this.clock = clock;
        this.sleeper = sleeper;
    }

    // Processes every sending issue. A no-op while another run is active.
    public void runPending() {
        if (!running.compareAndSet(false, true)) return;
        try {
            long[] quota = {remainingQuota()};
            for (UUID id : issues.findSendingIds()) {
                if (process(id, quota) == Outcome.STOPPED) break;
            }
        } catch (RuntimeException e) {
            log.warn("Digest sending run failed (the next tick retries): {}", e.getMessage(), e);
        } finally {
            running.set(false);
        }
    }

    long remainingQuota() {
        var since = OffsetDateTime.now(clock).minusHours(24);
        return Math.max(0, props.dailyLimit() - deliveries.countAttemptsSince(since));
    }

    Outcome process(UUID issueId, long[] quota) {
        DigestIssue entity = issues.findById(issueId).orElse(null);
        if (entity == null || !DigestIssue.SENDING.equals(entity.getStatus())) return Outcome.CANCELLED;
        var issue = DigestComposer.Issue.of(entity);
        // Shared content: rendered once per run, only the per-reader parts vary.
        var template = composer.template(issue, composer.content(issue));

        while (true) {
            List<DigestDelivery> batch = deliveries.findPending(issueId, Limit.of(PAGE));
            if (batch.isEmpty()) {
                if (issues.markSentIfDone(issueId, OffsetDateTime.now(clock)) > 0) {
                    log.info("Digest {}: all deliveries processed, issue sent", issue.week().weekStart());
                }
                return Outcome.DONE;
            }
            // "Tu cuatrimestre" of the whole page, batch-loaded.
            var personal = composer.personalSections(issue,
                batch.stream().map(DigestDelivery::getUserId).toList());
            for (DigestDelivery d : batch) {
                if (quota[0] <= 0) {
                    log.info("Digest sending paused: daily limit of {} reached", props.dailyLimit());
                    return Outcome.STOPPED;
                }
                Step step = tx.execute(s -> sendOne(issue, template, d, personal.get(d.getUserId())));
                switch (step) {
                    case CANCELLED -> {
                        log.info("Digest {}: no longer sending, stopped", issue.week().weekStart());
                        return Outcome.CANCELLED;
                    }
                    case TRANSIENT -> {
                        return Outcome.STOPPED;
                    }
                    case SKIPPED -> { }
                    case SENT, FAILED -> {
                        quota[0]--;
                        try {
                            sleeper.sleep(props.sendInterval());
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                            return Outcome.STOPPED;
                        }
                    }
                }
            }
        }
    }

    // Runs inside one transaction (see the class comment).
    Step sendOne(DigestComposer.Issue issue, DigestRenderer.Template template, DigestDelivery d,
                 DigestPersonalSection.Section personal) {
        String status = issues.findStatusForShare(issue.id()).orElse(null);
        if (!DigestIssue.SENDING.equals(status)) return Step.CANCELLED;

        // Unsubscribed, unfollowed CEITBA or left the allowed domains since
        // the snapshot: dropped.
        if (!composer.stillEligible(d.getUserId(), d.getEmail())) {
            deliveries.deletePending(issue.id(), d.getUserId());
            return Step.SKIPPED;
        }
        try {
            sender.send(composer.email(issue, template, d.getUserId(), d.getEmail(), false, personal));
        } catch (EmailSendException e) {
            if (e.kind() == EmailSendException.Kind.TRANSIENT) {
                log.warn("Digest sending paused, transport problem (retried later): {}", e.getMessage());
                return Step.TRANSIENT;
            }
            deliveries.markFailed(issue.id(), d.getUserId(), OffsetDateTime.now(clock), truncate(e.getMessage()));
            return Step.FAILED;
        } catch (RuntimeException e) {
            log.warn("Digest delivery to user {} failed: {}", d.getUserId(), e.getMessage());
            deliveries.markFailed(issue.id(), d.getUserId(), OffsetDateTime.now(clock), truncate(e.toString()));
            return Step.FAILED;
        }
        deliveries.markSent(issue.id(), d.getUserId(), OffsetDateTime.now(clock));
        return Step.SENT;
    }

    private static String truncate(String s) {
        if (s == null) return "unknown error";
        return s.length() <= MAX_ERROR_LENGTH ? s : s.substring(0, MAX_ERROR_LENGTH);
    }
}
