package org.ceitba.api.service.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Optional;
import java.util.function.Predicate;

// THE EmailSender of the app (MailConfig wires the SMTP/logging transport
// inside it and exposes only this): every email, whoever sends it (digest,
// test sends, later org emails), goes through the sending-quota ledger
// (docs/WEEKLY-DIGEST.md, "Sending quota").
//
//   - Every attempt is logged in mail_send_log (account = From address,
//     kind, recipients, outcome). The quota counts the recipients of the
//     attempts that reached the provider (sent + rejected).
//   - Rolling window: remaining = limit - used in the last 24h. With no
//     quota left nothing is sent: MailQuotaExhaustedException(resumeAt =
//     when enough of the oldest attempts leave the window).
//   - Gmail's own daily-limit error (5.4.5, EmailSendException QUOTA) is
//     authoritative: the account is paused for quotaPause (24h), or until
//     the rolling-window estimate if that is later. Persisted.
//   - Other transport errors pause the account with exponential backoff
//     (5 min, 10, 20, 40, then 1 h). Persisted. Only background senders
//     honour the backoff (readyAt()); a manual send still tries, so staff
//     can check whether SMTP is back. Any successful send clears it.
//     (EmailSendException TRANSPORT; a TRANSIENT error is a 4.x.x reply
//     scoped to one delivery and does not pause the account.)
//   - Defense in depth: digest and test emails to an address outside the
//     allowed domains (digest.allowed-domains) are refused here, whatever the
//     caller checked (EmailSendException RECIPIENT, nothing sent or logged).
// One process sends at a time per account (single API instance): the quota
// check, the SMTP call and the ledger row are serialized.
public class MailSendService implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(MailSendService.class);

    public static final Duration WINDOW = Duration.ofHours(24);
    public static final String PAUSE_QUOTA = "quota";
    public static final String PAUSE_TRANSPORT = "transport";

    public record QuotaStatus(String account, int limit, long usedLast24h, long remaining,
                              Instant pausedUntil, String pauseReason, Instant nextCapacityAt) {}

    private final EmailSender transport;
    private final MailLedger ledger;
    private final String account;
    private final int limit;
    private final Duration backoffInitial;
    private final Duration backoffMax;
    private final Duration quotaPause;
    private final Clock clock;
    private final Predicate<String> allowedRecipient;
    private final Object lock = new Object();

    public MailSendService(EmailSender transport, MailLedger ledger, String account, int limit,
                           Duration backoffInitial, Duration backoffMax, Duration quotaPause, Clock clock) {
        this(transport, ledger, account, limit, backoffInitial, backoffMax, quotaPause, clock, to -> true);
    }

    // allowedRecipient: the domain guard applied to the digest and test kinds.
    public MailSendService(EmailSender transport, MailLedger ledger, String account, int limit,
                           Duration backoffInitial, Duration backoffMax, Duration quotaPause, Clock clock,
                           Predicate<String> allowedRecipient) {
        this.transport = transport;
        this.ledger = ledger;
        this.account = account;
        this.limit = Math.max(0, limit);
        this.backoffInitial = backoffInitial;
        this.backoffMax = backoffMax;
        this.quotaPause = quotaPause;
        this.clock = clock;
        this.allowedRecipient = allowedRecipient;
    }

    // False when the transport cannot really send (MAIL_ENABLED=false).
    @Override
    public boolean enabled() {
        return transport.enabled();
    }

    public String account() { return account; }

    public int limit() { return limit; }

    // Sends one email (one recipient) if the account has quota. Throws
    // MailQuotaExhaustedException (nothing sent, nothing logged) or the
    // transport's EmailSendException (logged, pause updated).
    @Override
    public void send(OutgoingEmail email) {
        final int recipients = 1;
        if (guarded(email.kind()) && !allowedRecipient.test(email.to())) {
            throw new EmailSendException(EmailSendException.Kind.RECIPIENT,
                "Recipient is outside the allowed domains", null);
        }
        synchronized (lock) {
            Instant now = clock.instant();
            Instant blocked = quotaBlockedUntil(now, recipients);
            if (blocked != null) throw new MailQuotaExhaustedException(account, blocked);
            try {
                transport.send(email);
            } catch (EmailSendException e) {
                onFailure(e, email.kind(), recipients);
                throw e;
            } catch (RuntimeException e) {
                ledger.record(account, email.kind(), recipients, MailLedger.Outcome.TRANSIENT, e.toString(),
                    clock.instant());
                throw e;
            }
            Instant at = clock.instant();
            ledger.record(account, email.kind(), recipients, MailLedger.Outcome.SENT, null, at);
            var state = ledger.state(account).orElse(MailLedger.State.CLEAR);
            if (!state.isClear()) ledger.saveState(account, MailLedger.State.CLEAR, at);
        }
    }

    // When the account may send again, if not now: the quota pause or an
    // exhausted rolling window, and the transport backoff. What background
    // senders check before touching SMTP.
    private static boolean guarded(String kind) {
        return OutgoingEmail.KIND_DIGEST.equals(kind) || OutgoingEmail.KIND_TEST.equals(kind);
    }

    public Optional<Instant> readyAt() {
        Instant now = clock.instant();
        Instant blocked = quotaBlockedUntil(now, 1);
        var state = ledger.state(account).orElse(MailLedger.State.CLEAR);
        if (state.pausedUntil() != null && state.pausedUntil().isAfter(now)) {
            blocked = later(blocked, state.pausedUntil());
        }
        return Optional.ofNullable(blocked);
    }

    public QuotaStatus status() {
        Instant now = clock.instant();
        long used = ledger.usedSince(account, now.minus(WINDOW));
        long remaining = Math.max(0, limit - used);
        var state = ledger.state(account).orElse(MailLedger.State.CLEAR);
        boolean paused = state.pausedUntil() != null && state.pausedUntil().isAfter(now);
        Instant next = remaining == 0 ? capacityFreesAt(now, used - limit + 1) : null;
        return new QuotaStatus(account, limit, used, remaining,
            paused ? state.pausedUntil() : null, paused ? state.pauseReason() : null, next);
    }

    // Estimated time the last of `emails` more emails goes out, one every
    // `interval` from when the account is ready, waiting for the rolling
    // window to free capacity whenever it is full. Assumes no other sends
    // and no new pause. Null when the limit is 0 (never).
    public Instant estimateFinish(long emails, Duration interval) {
        if (limit <= 0) return null;
        Instant now = clock.instant();
        Instant t = readyAt().filter(r -> r.isAfter(now)).orElse(now);
        if (emails <= 0) return t;
        var window = new ArrayDeque<Instant>();
        for (var u : ledger.usageSince(account, now.minus(WINDOW))) {
            for (int i = 0; i < u.recipients(); i++) window.addLast(u.at());
        }
        for (long n = 0; n < emails; n++) {
            while (true) {
                while (!window.isEmpty() && !window.peekFirst().plus(WINDOW).isAfter(t)) window.pollFirst();
                if (window.size() < limit) break;
                t = window.peekFirst().plus(WINDOW);
            }
            window.addLast(t);
            if (n < emails - 1) t = t.plus(interval);
        }
        return t;
    }

    // ------------------------------------------------------------ internals

    // Null if `recipients` more can go out now as far as the quota goes
    // (rolling window and Gmail's own pause; not the transport backoff).
    Instant quotaBlockedUntil(Instant now, int recipients) {
        var state = ledger.state(account).orElse(MailLedger.State.CLEAR);
        Instant blocked = null;
        if (PAUSE_QUOTA.equals(state.pauseReason()) && state.pausedUntil() != null
                && state.pausedUntil().isAfter(now)) {
            blocked = state.pausedUntil();
        }
        long used = ledger.usedSince(account, now.minus(WINDOW));
        if (used + recipients > limit) {
            blocked = later(blocked, capacityFreesAt(now, used + recipients - limit));
        }
        return blocked;
    }

    // When `units` recipients have left the rolling window: the attempt at
    // which the cumulative count (oldest first) reaches `units`, plus 24h.
    Instant capacityFreesAt(Instant now, long units) {
        if (units <= 0) return now;
        long cum = 0;
        for (var u : ledger.usageSince(account, now.minus(WINDOW))) {
            cum += u.recipients();
            if (cum >= units) return u.at().plus(WINDOW);
        }
        // More than the whole window (a limit of 0, or a single send bigger
        // than the limit): a full window from now.
        return now.plus(WINDOW);
    }

    private void onFailure(EmailSendException e, String kind, int recipients) {
        Instant now = clock.instant();
        var state = ledger.state(account).orElse(MailLedger.State.CLEAR);
        switch (e.kind()) {
            case RECIPIENT -> ledger.record(account, kind, recipients, MailLedger.Outcome.REJECTED, e.getMessage(), now);
            case QUOTA -> {
                ledger.record(account, kind, recipients, MailLedger.Outcome.QUOTA, e.getMessage(), now);
                long used = ledger.usedSince(account, now.minus(WINDOW));
                Instant until = now.plus(quotaPause);
                if (used >= limit) until = later(until, capacityFreesAt(now, used - limit + 1));
                ledger.saveState(account, new MailLedger.State(until, PAUSE_QUOTA, state.consecutiveFailures()), now);
                log.warn("Mail: {} hit the provider's daily sending limit; paused until {}", account, until);
            }
            case TRANSIENT -> {
                // Temporary and scoped to one delivery: logged, but the
                // account is not paused (the caller retries that delivery).
                ledger.record(account, kind, recipients, MailLedger.Outcome.TRANSIENT, e.getMessage(), now);
            }
            case TRANSPORT -> {
                ledger.record(account, kind, recipients, MailLedger.Outcome.TRANSIENT, e.getMessage(), now);
                int failures = state.consecutiveFailures() + 1;
                Instant until = now.plus(backoff(failures));
                // Never shorten a quota pause.
                if (PAUSE_QUOTA.equals(state.pauseReason()) && state.pausedUntil() != null
                        && state.pausedUntil().isAfter(until)) {
                    ledger.saveState(account, new MailLedger.State(state.pausedUntil(), PAUSE_QUOTA, failures), now);
                } else {
                    ledger.saveState(account, new MailLedger.State(until, PAUSE_TRANSPORT, failures), now);
                }
                log.warn("Mail: transport problem for {} (failure {} in a row), backing off until {}: {}",
                    account, failures, until, e.getMessage());
            }
        }
    }

    // initial * 2^(failures-1), capped.
    Duration backoff(int failures) {
        Duration d = backoffInitial;
        for (int i = 1; i < failures && d.compareTo(backoffMax) < 0; i++) d = d.multipliedBy(2);
        return d.compareTo(backoffMax) > 0 ? backoffMax : d;
    }

    private static Instant later(Instant a, Instant b) {
        if (a == null) return b;
        if (b == null) return a;
        return a.isAfter(b) ? a : b;
    }
}
