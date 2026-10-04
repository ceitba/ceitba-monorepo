package org.ceitba.api.service.digest;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.digest.DigestDelivery;
import org.ceitba.api.domain.digest.DigestIssue;
import org.ceitba.api.repository.digest.DigestDeliveryRepository;
import org.ceitba.api.repository.digest.DigestIssueRepository;
import org.ceitba.api.service.mail.EmailSendException;
import org.ceitba.api.service.mail.MailLinkRewriter;
import org.ceitba.api.service.mail.MailQuotaExhaustedException;
import org.ceitba.api.service.mail.MailSendService;
import org.ceitba.api.service.mail.OutgoingEmail;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

// The sending worker (docs/WEEKLY-DIGEST.md). Walks the pending deliveries of
// every `sending` issue, one email at a time, at most once each:
//   1. claim: its own committed transaction picks the next pending row
//      (FOR UPDATE SKIP LOCKED, so two workers never share one) and sets it
//      `sending` with claimed_at;
//   2. send: a second transaction holds a share lock on the issue row,
//      re-checks the issue is still `sending`, makes the SMTP call and marks
//      the row sent/failed (the update count is checked). A cancel takes the
//      row lock, so it waits for the email in flight and nothing is sent
//      after it commits.
// A row still `sending` after digest.claim-timeout means the process died
// around the SMTP call: whether the email left is unknown, so it is marked
// failed ("unknown outcome (interrupted)") and never resent.
//   - throttled (digest.send-interval between emails)
//   - sender account (Gmail API transport): when it is missing or broken the
//     run is skipped before any delivery is claimed (nothing logged in
//     mail_send_log, no attempt consumed); logged once per state change
//   - sending quota (MailSendService, rolling 24h per sending account,
//     shared with test sends and any other email): while the account is
//     paused or out of quota the run does not even start; when the quota
//     runs out mid-run it stops, and a later tick resumes once capacity
//     frees (so a big issue simply overflows into the next day)
//   - a claimed recipient who unsubscribed/unfollowed CEITBA meanwhile is dropped
//   - RECIPIENT error: that delivery fails and the run goes on. TRANSIENT
//     error: the delivery is retried later and fails after MAX_ATTEMPTS, the
//     run goes on. TRANSPORT error (auth, connection) or QUOTA (Gmail's daily
//     limit): the run stops, nothing is blamed on the delivery, and
//     MailSendService pauses the account (backoff / 24h).
//   - open/click tracking (DigestTrackingService): each delivery gets a
//     random tracking id and its links rewritten right before sending
//   - no pending row left: the issue becomes `sent`
// One run at a time per process; a second process is safe thanks to SKIP LOCKED.
// On shutdown (ContextClosedEvent) the run finishes the email in flight and stops.
@Component
public class DigestSender {

    private static final Logger log = LoggerFactory.getLogger(DigestSender.class);
    private static final int MAX_ERROR_LENGTH = 1000;

    // TRANSIENT failures of one delivery before it is given up (marked failed).
    static final int MAX_ATTEMPTS = 3;
    // A `sending` row older than this has an unknown outcome (SMTP timeouts
    // are seconds, so a live send never gets close).
    static final Duration CLAIM_TIMEOUT = Duration.ofMinutes(5);
    // Minimum wait before a delivery that failed TRANSIENTly is tried again.
    static final Duration RETRY_DELAY = Duration.ofMinutes(2);
    static final String UNKNOWN_OUTCOME = "unknown outcome (interrupted)";

    public interface Sleeper {
        void sleep(Duration d) throws InterruptedException;
    }

    public enum Outcome { DONE, STOPPED, CANCELLED }

    enum Step { SENT, FAILED, SKIPPED, RETRY, TRANSPORT, QUOTA, CANCELLED }

    private final DigestIssueRepository issues;
    private final DigestDeliveryRepository deliveries;
    private final DigestComposer composer;
    private final MailSendService sender;
    private final DigestTrackingService tracking;
    private final DigestProperties props;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final Sleeper sleeper;
    private final AtomicBoolean running = new AtomicBoolean();
    private volatile boolean stopping;
    // Last "sender unavailable" reason logged (null = usable), so a state
    // change is logged once instead of every tick.
    private volatile String lastUnavailable;

    @Autowired
    public DigestSender(DigestIssueRepository issues, DigestDeliveryRepository deliveries,
                        DigestComposer composer, MailSendService sender, DigestTrackingService tracking,
                        DigestProperties props, PlatformTransactionManager txManager, Clock clock) {
        this(issues, deliveries, composer, sender, tracking, props, txManager, clock, d -> Thread.sleep(d));
    }

    DigestSender(DigestIssueRepository issues, DigestDeliveryRepository deliveries,
                 DigestComposer composer, MailSendService sender, DigestTrackingService tracking,
                 DigestProperties props, PlatformTransactionManager txManager, Clock clock, Sleeper sleeper) {
        this.issues = issues;
        this.deliveries = deliveries;
        this.composer = composer;
        this.sender = sender;
        this.tracking = tracking;
        this.props = props;
        this.tx = new TransactionTemplate(txManager);
        this.clock = clock;
        this.sleeper = sleeper;
    }

    // Graceful shutdown: the email in flight is finished (the task executor
    // waits for termination), no new one is started.
    @EventListener(ContextClosedEvent.class)
    void onShutdown() {
        stopping = true;
    }

    // Processes every sending issue. A no-op while another run is active, or
    // while mail is disabled (issues stay `sending` until it is enabled).
    public void runPending() {
        if (!sender.enabled()) {
            log.debug("Digest sending skipped: mail is disabled (MAIL_ENABLED=false)");
            return;
        }
        if (!running.compareAndSet(false, true)) return;
        try {
            reclaimStale();
            var ids = issues.findSendingIds();
            if (ids.isEmpty()) return;
            // The sender account itself is unusable (Gmail API: missing,
            // broken, undecryptable token): skip the tick before claiming
            // anything, so no delivery burns an attempt and nothing is
            // written to mail_send_log. Logged once per state change.
            if (senderUnavailable()) return;
            // Paused or out of quota: don't touch SMTP until then.
            var readyAt = sender.readyAt();
            if (readyAt.isPresent()) {
                log.debug("Digest sending waits until {} (sending quota / pause of {})", readyAt.get(), sender.account());
                return;
            }
            for (UUID id : ids) {
                if (stopping) break;
                if (process(id) == Outcome.STOPPED) break;
            }
        } catch (RuntimeException e) {
            log.warn("Digest sending run failed (the next tick retries): {}", e.getMessage(), e);
        } finally {
            running.set(false);
        }
    }

    private boolean senderUnavailable() {
        var reason = sender.unavailableReason().orElse(null);
        String previous = lastUnavailable;
        if (!java.util.Objects.equals(reason, previous)) {
            lastUnavailable = reason;
            if (reason != null) {
                log.warn("Digest sending skipped until the sender account is fixed: {}", reason);
            } else {
                log.info("Digest sending resumes: the sender account is usable again");
            }
        }
        return reason != null;
    }

    // Rows left `sending` by a crash: outcome unknown -> failed, not resent.
    void reclaimStale() {
        int n = deliveries.failStale(OffsetDateTime.now(clock).minus(CLAIM_TIMEOUT), UNKNOWN_OUTCOME);
        if (n > 0) {
            log.warn("Digest: {} deliveries were interrupted mid-send; marked failed, not resent", n);
        }
    }

    Outcome process(UUID issueId) {
        DigestIssue entity = issues.findById(issueId).orElse(null);
        if (entity == null || !DigestIssue.SENDING.equals(entity.getStatus())) return Outcome.CANCELLED;
        var issue = DigestComposer.Issue.of(entity);
        // Shared content: rendered once per run, only the per-reader parts vary.
        var template = composer.template(issue, composer.content(issue));
        Map<String, Integer> sharedLinks = tracking.enabled() ? tracking.issueLinks(issueId, template) : Map.of();

        while (true) {
            if (stopping) return Outcome.STOPPED;
            DigestDelivery d = tx.execute(s -> claimNext(issue.id()));
            if (d == null) {
                markSentIfDone(issue);
                return Outcome.DONE;
            }
            Step step = tx.execute(s -> sendClaimed(issue, template, d, sharedLinks));
            switch (step) {
                case CANCELLED -> {
                    log.info("Digest {}: no longer sending, stopped", issue.week().weekStart());
                    return Outcome.CANCELLED;
                }
                case TRANSPORT, QUOTA -> {
                    return Outcome.STOPPED;
                }
                case SKIPPED -> { }
                case SENT, FAILED, RETRY -> {
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

    private boolean markSentIfDone(DigestComposer.Issue issue) {
        boolean done = issues.markSentIfDone(issue.id(), OffsetDateTime.now(clock)) > 0;
        if (done) log.info("Digest {}: all deliveries processed, issue sent", issue.week().weekStart());
        return done;
    }

    // Step 1, in its own committed transaction: pick the next pending row
    // (SKIP LOCKED) and mark it `sending`. null = nothing to send right now.
    DigestDelivery claimNext(UUID issueId) {
        var now = OffsetDateTime.now(clock);
        var next = deliveries.lockNextPending(issueId, now.minus(RETRY_DELAY)).orElse(null);
        if (next == null) return null;
        if (deliveries.markSending(issueId, next.getUserId(), now) == 0) return null;
        return next;
    }

    // Step 2, one transaction (see the class comment).
    Step sendClaimed(DigestComposer.Issue issue, DigestRenderer.Template template, DigestDelivery d,
                     Map<String, Integer> sharedLinks) {
        UUID issueId = issue.id();
        UUID userId = d.getUserId();
        String status = issues.findStatusForShare(issueId).orElse(null);
        if (!DigestIssue.SENDING.equals(status)) {
            // Cancelled between the claim and now: never sent, drop the claim.
            deliveries.deleteClaimed(issueId, userId);
            return Step.CANCELLED;
        }

        // Unsubscribed, unfollowed CEITBA or left the allowed domains since
        // the snapshot: dropped.
        if (!composer.stillEligible(userId, d.getEmail())) {
            deliveries.deleteClaimed(issueId, userId);
            return Step.SKIPPED;
        }
        try {
            OutgoingEmail email = composer.email(issue, template, userId, d.getEmail(), false);
            if (tracking.enabled()) {
                // Kept across retries of the same delivery.
                String trackingId = d.getTrackingId() != null ? d.getTrackingId() : MailLinkRewriter.newTrackingId();
                var tracked = tracking.track(email, trackingId, sharedLinks);
                deliveries.setTrackingId(issue.id(), userId, trackingId);
                tracking.saveDeliveryLinks(trackingId, tracked.personalLinks());
                email = tracked.email();
            }
            sender.send(email);
        } catch (MailQuotaExhaustedException e) {
            // Nothing was sent: the claim goes back, no attempt counted.
            log.info("Digest sending paused: sending quota of {} used up, resumes at {}", e.account(), e.resumeAt());
            deliveries.release(issueId, userId, truncate(e.getMessage()));
            return Step.QUOTA;
        } catch (EmailSendException e) {
            switch (e.kind()) {
                case TRANSPORT, QUOTA -> {
                    log.warn("Digest sending paused, transport problem (retried later): {}", e.getMessage());
                    deliveries.release(issueId, userId, truncate(e.getMessage()));
                    return Step.TRANSPORT;
                }
                case TRANSIENT -> {
                    int attempts = d.getAttempts() + 1;
                    if (attempts >= MAX_ATTEMPTS) {
                        return fail(issueId, userId,
                            "gave up after " + attempts + " attempts: " + truncate(e.getMessage()));
                    }
                    log.warn("Digest delivery to user {}: temporary failure, attempt {}/{}: {}",
                        userId, attempts, MAX_ATTEMPTS, e.getMessage());
                    deliveries.retryLater(issueId, userId, truncate(e.getMessage()));
                    return Step.RETRY;
                }
                default -> {
                    return fail(issueId, userId, truncate(e.getMessage()));
                }
            }
        } catch (RuntimeException e) {
            log.warn("Digest delivery to user {} failed: {}", userId, e.getMessage());
            return fail(issueId, userId, truncate(e.toString()));
        }
        if (deliveries.markSent(issueId, userId, OffsetDateTime.now(clock)) == 0) {
            log.error("Digest delivery to user {} was sent but its row was no longer `sending`", userId);
        }
        return Step.SENT;
    }

    private Step fail(UUID issueId, UUID userId, String error) {
        if (deliveries.markFailed(issueId, userId, OffsetDateTime.now(clock), error) == 0) {
            log.error("Digest delivery to user {} failed but its row was no longer `sending`", userId);
        }
        return Step.FAILED;
    }

    private static String truncate(String s) {
        if (s == null) return "unknown error";
        return s.length() <= MAX_ERROR_LENGTH ? s : s.substring(0, MAX_ERROR_LENGTH);
    }
}
