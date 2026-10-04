package org.ceitba.api.domain.mail;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;

// Persisted pause of a sending account (Gmail's daily-limit error, or the
// backoff after transport errors), so it survives restarts.
@Entity
@Table(schema = "public", name = "mail_account_state")
public class MailAccountState {

    @Id
    private String account;

    @Column(name = "paused_until")
    private OffsetDateTime pausedUntil;

    // quota | transport | null
    @Column(name = "pause_reason")
    private String pauseReason;

    @Column(name = "consecutive_failures", nullable = false)
    private int consecutiveFailures;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected MailAccountState() {}

    public MailAccountState(String account, OffsetDateTime pausedUntil, String pauseReason,
                            int consecutiveFailures, OffsetDateTime updatedAt) {
        this.account = account;
        this.pausedUntil = pausedUntil;
        this.pauseReason = pauseReason;
        this.consecutiveFailures = consecutiveFailures;
        this.updatedAt = updatedAt;
    }

    public String getAccount() { return account; }
    public OffsetDateTime getPausedUntil() { return pausedUntil; }
    public String getPauseReason() { return pauseReason; }
    public int getConsecutiveFailures() { return consecutiveFailures; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void set(OffsetDateTime pausedUntil, String pauseReason, int consecutiveFailures, OffsetDateTime now) {
        this.pausedUntil = pausedUntil;
        this.pauseReason = pauseReason;
        this.consecutiveFailures = consecutiveFailures;
        this.updatedAt = now;
    }
}
