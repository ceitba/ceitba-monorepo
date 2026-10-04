package org.ceitba.api.service.mail;

// The Gmail API transport has no usable connected sender account (never
// connected, revoked, or broken: Google rejected its token). A transport
// problem for the worker (EmailSendException TRANSIENT: backoff, nothing
// dropped); a direct test send answers 409 MAIL_SENDER_NOT_CONNECTED.
public class MailSenderNotConnectedException extends EmailSendException {

    public static final String CODE = "MAIL_SENDER_NOT_CONNECTED";

    public MailSenderNotConnectedException(String message) {
        super(Kind.TRANSIENT, message, null);
    }
}
