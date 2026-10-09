package org.ceitba.api.service.orgmail;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.orgmail.OrgAnnouncement;
import org.ceitba.api.domain.orgmail.OrgAnnouncementDelivery;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.orgmail.OrgAnnouncementDeliveryRepository;
import org.ceitba.api.repository.orgmail.OrgAnnouncementRepository;
import org.ceitba.api.service.mail.EmailSendException;
import org.ceitba.api.service.mail.MailQuotaExhaustedException;
import org.ceitba.api.service.mail.MailSendService;
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
import java.util.concurrent.atomic.AtomicBoolean;

// Sends organizations' announcements, one email at a time, at most once each,
// exactly like DigestSender (see its class comment): claim the next pending
// delivery in its own committed transaction (FOR UPDATE SKIP LOCKED), then
// send and mark it in a second one; a row left `sending` past CLAIM_TIMEOUT
// has an unknown outcome and is failed, never resent. Each announcement goes
// out through its org's own account (OrgMailSenders): a missing, broken,
// paused or exhausted account skips that announcement until a later tick;
// TRANSIENT errors are retried up to MAX_ATTEMPTS; a recipient who unfollowed
// or opted out meanwhile is dropped. Throttled by digest.send-interval.
@Component
public class OrgAnnouncementSender {

    private static final Logger log = LoggerFactory.getLogger(OrgAnnouncementSender.class);
    private static final int MAX_ERROR_LENGTH = 1000;

    static final int MAX_ATTEMPTS = 3;
    static final Duration CLAIM_TIMEOUT = Duration.ofMinutes(5);
    static final Duration RETRY_DELAY = Duration.ofMinutes(2);
    static final String UNKNOWN_OUTCOME = "unknown outcome (interrupted)";

    public interface Sleeper {
        void sleep(Duration d) throws InterruptedException;
    }

    enum Step { SENT, FAILED, SKIPPED, RETRY, STOP }

    private final OrgAnnouncementRepository announcements;
    private final OrgAnnouncementDeliveryRepository deliveries;
    private final OrganizationRepository orgs;
    private final OrgAnnouncementService service;
    private final DigestProperties props;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final Sleeper sleeper;
    private final AtomicBoolean running = new AtomicBoolean();
    private volatile boolean stopping;

    @Autowired
    public OrgAnnouncementSender(OrgAnnouncementRepository announcements, OrgAnnouncementDeliveryRepository deliveries,
                                 OrganizationRepository orgs, OrgAnnouncementService service, DigestProperties props,
                                 PlatformTransactionManager txManager, Clock clock) {
        this(announcements, deliveries, orgs, service, props, txManager, clock, d -> Thread.sleep(d));
    }

    OrgAnnouncementSender(OrgAnnouncementRepository announcements, OrgAnnouncementDeliveryRepository deliveries,
                          OrganizationRepository orgs, OrgAnnouncementService service, DigestProperties props,
                          PlatformTransactionManager txManager, Clock clock, Sleeper sleeper) {
        this.announcements = announcements;
        this.deliveries = deliveries;
        this.orgs = orgs;
        this.service = service;
        this.props = props;
        this.tx = new TransactionTemplate(txManager);
        this.clock = clock;
        this.sleeper = sleeper;
    }

    @EventListener(ContextClosedEvent.class)
    void onShutdown() {
        stopping = true;
    }

    // Processes every sending announcement; a no-op while another run is active.
    public void runPending() {
        if (!running.compareAndSet(false, true)) return;
        try {
            int stale = deliveries.failStale(OffsetDateTime.now(clock).minus(CLAIM_TIMEOUT), UNKNOWN_OUTCOME);
            if (stale > 0) log.warn("Org mail: {} deliveries were interrupted mid-send; marked failed", stale);
            for (Long id : announcements.findSendingIds()) {
                if (stopping) break;
                process(id);
            }
        } catch (RuntimeException e) {
            log.warn("Org mail sending run failed (the next tick retries): {}", e.getMessage(), e);
        } finally {
            running.set(false);
        }
    }

    void process(Long id) {
        OrgAnnouncement a = announcements.findById(id).orElse(null);
        if (a == null || !OrgAnnouncement.SENDING.equals(a.getStatus())) return;
        var org = orgs.findById(a.getOrgSlug()).orElse(null);
        MailSendService sender = service.senderOf(a).orElse(null);
        if (org == null || sender == null) return;
        if (!sender.enabled()) return;
        var unavailable = sender.unavailableReason();
        if (unavailable.isPresent()) {
            log.debug("Org mail {} waits: {}", id, unavailable.get());
            return;
        }
        if (sender.readyAt().isPresent()) return;

        while (!stopping) {
            OrgAnnouncementDelivery d = tx.execute(s -> claimNext(id));
            if (d == null) {
                if (announcements.markSentIfDone(id, OffsetDateTime.now(clock)) > 0) {
                    log.info("Org mail {} of {}: all deliveries processed", id, a.getOrgSlug());
                }
                return;
            }
            Step step = tx.execute(s -> sendClaimed(org, a, sender, d));
            if (step == Step.STOP) return;
            if (step != Step.SKIPPED) {
                try {
                    sleeper.sleep(props.sendInterval());
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    OrgAnnouncementDelivery claimNext(Long id) {
        var now = OffsetDateTime.now(clock);
        var next = deliveries.lockNextPending(id, now.minus(RETRY_DELAY)).orElse(null);
        if (next == null) return null;
        if (deliveries.markSending(id, next.getUserId(), now) == 0) return null;
        return next;
    }

    Step sendClaimed(org.ceitba.api.domain.news.Organization org, OrgAnnouncement a, MailSendService sender,
                     OrgAnnouncementDelivery d) {
        Long id = a.getId();
        var userId = d.getUserId();
        if (!service.stillRecipient(userId, d.getEmail(), a.getOrgSlug())) {
            deliveries.deleteClaimed(id, userId);
            return Step.SKIPPED;
        }
        try {
            sender.send(service.email(org, a, userId, d.getEmail(), false));
        } catch (MailQuotaExhaustedException e) {
            log.info("Org mail {} paused: quota of {} used up, resumes at {}", id, e.account(), e.resumeAt());
            deliveries.release(id, userId, truncate(e.getMessage()));
            return Step.STOP;
        } catch (EmailSendException e) {
            switch (e.kind()) {
                case TRANSPORT, QUOTA -> {
                    log.warn("Org mail {} paused, transport problem (retried later): {}", id, e.getMessage());
                    deliveries.release(id, userId, truncate(e.getMessage()));
                    return Step.STOP;
                }
                case TRANSIENT -> {
                    if (d.getAttempts() + 1 >= MAX_ATTEMPTS) {
                        return fail(id, userId, "gave up after " + (d.getAttempts() + 1) + " attempts: "
                            + truncate(e.getMessage()));
                    }
                    deliveries.retryLater(id, userId, truncate(e.getMessage()));
                    return Step.RETRY;
                }
                default -> {
                    return fail(id, userId, truncate(e.getMessage()));
                }
            }
        } catch (RuntimeException e) {
            log.warn("Org mail {} delivery to user {} failed: {}", id, userId, e.getMessage());
            return fail(id, userId, truncate(e.toString()));
        }
        if (deliveries.markSent(id, userId, OffsetDateTime.now(clock)) == 0) {
            log.error("Org mail {} delivery to user {} was sent but its row was no longer `sending`", id, userId);
        }
        return Step.SENT;
    }

    private Step fail(Long id, java.util.UUID userId, String error) {
        if (deliveries.markFailed(id, userId, OffsetDateTime.now(clock), error) == 0) {
            log.error("Org mail {} delivery to user {} failed but its row was no longer `sending`", id, userId);
        }
        return Step.FAILED;
    }

    private static String truncate(String s) {
        if (s == null) return "unknown error";
        return s.length() <= MAX_ERROR_LENGTH ? s : s.substring(0, MAX_ERROR_LENGTH);
    }
}
