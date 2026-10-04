package org.ceitba.api.service.mail;

import jakarta.mail.MessagingException;
import jakarta.mail.SendFailedException;
import jakarta.mail.internet.InternetAddress;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailException;
import org.springframework.mail.MailParseException;
import org.springframework.mail.MailPreparationException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;

// SMTP via Spring Mail (spring.mail.*: smtp.gmail.com:587 STARTTLS with the
// ceitba@itba.edu.ar app password, docs/WEEKLY-DIGEST.md).
public class SmtpEmailSender implements EmailSender {

    private final JavaMailSender mailSender;
    private final InternetAddress from;

    public SmtpEmailSender(JavaMailSender mailSender, String from) {
        this.mailSender = mailSender;
        try {
            this.from = new InternetAddress(from, true);
        } catch (MessagingException e) {
            throw new IllegalStateException("mail.from (MAIL_FROM) is not a valid address: " + from, e);
        }
    }

    @Override
    public void send(OutgoingEmail email) {
        var message = mailSender.createMimeMessage();
        try {
            var helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
            helper.setFrom(from);
            helper.setTo(new InternetAddress(email.to(), true));
            helper.setSubject(email.subject());
            helper.setText(email.text(), email.html());
            for (var h : email.headers().entrySet()) {
                message.setHeader(h.getKey(), h.getValue());
            }
        } catch (MessagingException e) {
            throw new EmailSendException(EmailSendException.Kind.RECIPIENT,
                "Could not build the message: " + e.getMessage(), e);
        }
        try {
            mailSender.send(message);
        } catch (MailException e) {
            throw classify(e);
        }
    }

    // SMTP replies that mean "not now" rather than "not this recipient":
    // 4xx and 534-535 (authentication).
    private static final Pattern TRANSIENT_REPLY =
        Pattern.compile("\\b(4\\d\\d[ -]4\\.\\d+\\.\\d+|53[45][ -]5\\.7\\.\\d+)\\b");
    // Gmail's daily sending limit: "550 5.4.5 Daily user sending limit
    // exceeded" (also "5.4.5 Daily SMTP relay limit exceeded").
    private static final Pattern QUOTA_REPLY = Pattern.compile("\\b5\\.4\\.5\\b");

    static EmailSendException classify(MailException e) {
        if (e instanceof MailAuthenticationException) {
            return new EmailSendException(EmailSendException.Kind.TRANSIENT, "SMTP authentication failed", e);
        }
        if (e instanceof MailParseException || e instanceof MailPreparationException) {
            return new EmailSendException(EmailSendException.Kind.RECIPIENT, e.getMessage(), e);
        }
        String text = messages(e).toLowerCase(Locale.ROOT);
        // Gmail's daily limit is authoritative: the account is paused a day.
        if (QUOTA_REPLY.matcher(text).find() || text.contains("sending limit exceeded")) {
            return new EmailSendException(EmailSendException.Kind.QUOTA, e.getMessage(), e);
        }
        // Gmail: "421 4.7.0 Try again later", "454 4.7.0 Too many login
        // attempts", "4.7.28 rate limited": back off.
        if (text.contains("limit exceeded") || text.contains("rate limit")
                || text.contains("try again later") || TRANSIENT_REPLY.matcher(text).find()) {
            return new EmailSendException(EmailSendException.Kind.TRANSIENT, e.getMessage(), e);
        }
        if (hasInvalidRecipient(e)) {
            return new EmailSendException(EmailSendException.Kind.RECIPIENT, e.getMessage(), e);
        }
        // Connection refused, timeouts, unknown: assume the transport.
        return new EmailSendException(EmailSendException.Kind.TRANSIENT, e.getMessage(), e);
    }

    private static boolean hasInvalidRecipient(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof SendFailedException sfe
                    && sfe.getInvalidAddresses() != null && sfe.getInvalidAddresses().length > 0) {
                return true;
            }
            if (t instanceof org.springframework.mail.MailSendException mse) {
                for (var nested : mse.getFailedMessages().values()) {
                    if (nested != null && nested != e && hasInvalidRecipient(nested)) return true;
                }
            }
        }
        return false;
    }

    private static String messages(Throwable e) {
        var sb = new StringBuilder(" ");
        for (Throwable t = e; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t.getMessage() != null) sb.append(t.getMessage()).append(' ');
            if (t instanceof org.springframework.mail.MailSendException mse) {
                for (var nested : mse.getFailedMessages().values()) {
                    if (nested != null && nested != t && nested.getMessage() != null) {
                        sb.append(nested.getMessage()).append(' ');
                    }
                }
            }
        }
        return sb.toString();
    }
}
