package org.ceitba.api.service.mail;

import org.ceitba.api.common.exception.DomainException;

import java.time.Instant;

// The sending account cannot send now: its rolling 24h quota is used up, or
// Gmail itself reported the daily limit. Nothing was sent. 429
// MAIL_QUOTA_EXHAUSTED with `resumeAt` (GlobalExceptionHandler).
public class MailQuotaExhaustedException extends DomainException {

    public static final String CODE = "MAIL_QUOTA_EXHAUSTED";

    private final String account;
    private final Instant resumeAt;

    public MailQuotaExhaustedException(String account, Instant resumeAt) {
        super("The daily sending limit of " + account + " is used up; sending resumes at " + resumeAt);
        this.account = account;
        this.resumeAt = resumeAt;
    }

    public String account() { return account; }
    public Instant resumeAt() { return resumeAt; }
}
