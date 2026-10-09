package org.ceitba.api.service.orgmail;

import org.ceitba.api.common.exception.DomainException;

// An organization's email can't be sent as asked. Mapped to 409 with the
// reason's code, which the web app switches on.
public class OrgMailException extends DomainException {

    public enum Reason {
        NOT_CONNECTED("OrgMailNotConnected", "The organization has no connected Gmail account"),
        MAIL_DISABLED("MailDisabled", "Sending email is disabled on this server"),
        WEEKLY_LIMIT("OrgMailWeeklyLimit", "The organization already sent its emails for this week"),
        NO_RECIPIENTS("OrgMailNoRecipients", "No follower can receive this email"),
        NOT_DRAFT("OrgMailNotDraft", "Only drafts can be changed or sent"),
        TEST_FAILED("OrgMailTestFailed", "The test email could not be sent");

        private final String code;
        private final String message;

        Reason(String code, String message) {
            this.code = code;
            this.message = message;
        }

        public String code() { return code; }
    }

    private final Reason reason;

    public OrgMailException(Reason reason) {
        super(reason.message);
        this.reason = reason;
    }

    public OrgMailException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() { return reason; }
}
