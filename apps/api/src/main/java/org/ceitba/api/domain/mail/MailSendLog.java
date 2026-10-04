package org.ceitba.api.domain.mail;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;

// One SMTP attempt made through MailSendService (the sending-quota ledger,
// docs/WEEKLY-DIGEST.md). Insert-only.
@Entity
@Table(schema = "public", name = "mail_send_log")
public class MailSendLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String account;

    @Column(nullable = false)
    private String kind;

    @Column(nullable = false)
    private int recipients;

    // sent | rejected | quota | transient
    @Column(nullable = false)
    private String outcome;

    @Column
    private String error;

    @Column(name = "attempted_at", nullable = false)
    private OffsetDateTime attemptedAt;

    protected MailSendLog() {}

    public MailSendLog(String account, String kind, int recipients, String outcome, String error,
                       OffsetDateTime attemptedAt) {
        this.account = account;
        this.kind = kind;
        this.recipients = recipients;
        this.outcome = outcome;
        this.error = error;
        this.attemptedAt = attemptedAt;
    }

    public Long getId() { return id; }
    public String getAccount() { return account; }
    public String getKind() { return kind; }
    public int getRecipients() { return recipients; }
    public String getOutcome() { return outcome; }
    public String getError() { return error; }
    public OffsetDateTime getAttemptedAt() { return attemptedAt; }
}
