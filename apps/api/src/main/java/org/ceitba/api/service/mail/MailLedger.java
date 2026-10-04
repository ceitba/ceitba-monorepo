package org.ceitba.api.service.mail;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

// Storage behind MailSendService: the attempt log (mail_send_log) and the
// persisted per-account pause (mail_account_state). JpaMailLedger in the
// app, an in-memory one in unit tests.
public interface MailLedger {

    enum Outcome {
        // Accepted by the provider.
        SENT,
        // This recipient/message was refused (counted: it reached Gmail).
        REJECTED,
        // The provider's own daily-limit error (not counted).
        QUOTA,
        // Transport problem: connection, authentication, 4xx (not counted).
        TRANSIENT;

        public String db() { return name().toLowerCase(java.util.Locale.ROOT); }
    }

    record Usage(Instant at, int recipients) {}

    record State(Instant pausedUntil, String pauseReason, int consecutiveFailures) {
        public static final State CLEAR = new State(null, null, 0);

        public boolean isClear() {
            return pausedUntil == null && pauseReason == null && consecutiveFailures == 0;
        }
    }

    // Recipients of the counted attempts (SENT, REJECTED) after `since`.
    long usedSince(String account, Instant since);

    // The counted attempts after `since`, oldest first.
    List<Usage> usageSince(String account, Instant since);

    // Committed on its own, whatever the caller's transaction does next: an
    // email that left must stay counted.
    void record(String account, String kind, int recipients, Outcome outcome, String error, Instant at);

    Optional<State> state(String account);

    void saveState(String account, State state, Instant now);
}
