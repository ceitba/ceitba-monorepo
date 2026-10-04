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
import java.util.regex.Matcher;
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

    // "550 5.4.5 ...", "452 4.2.2 ...": the reply code and its enhanced status.
    private static final Pattern REPLY = Pattern.compile("\\b([245]\\d\\d)[ -]([245])\\.(\\d{1,3})\\.(\\d{1,3})\\b");

    static EmailSendException classify(MailException e) {
        if (e instanceof MailAuthenticationException) {
            return new EmailSendException(EmailSendException.Kind.TRANSPORT, "SMTP authentication failed", e);
        }
        if (e instanceof MailParseException || e instanceof MailPreparationException) {
            return new EmailSendException(EmailSendException.Kind.RECIPIENT, e.getMessage(), e);
        }
        var kind = classifyReply(messages(e));
        if (kind == null) {
            // No usable reply code: a rejected address still blames the
            // recipient; connection refused, timeouts and the rest are the
            // transport's.
            kind = hasInvalidRecipient(e) ? EmailSendException.Kind.RECIPIENT : EmailSendException.Kind.TRANSPORT;
        }
        return new EmailSendException(kind, e.getMessage(), e);
    }

    // Who an SMTP reply blames, from its first "<code> <class.subject.detail>"
    // pair (null = no such pair in the text):
    //   QUOTA      5.4.5 / "sending limit exceeded": Gmail's daily sending
    //              limit, authoritative (the account is paused for a day)
    //   RECIPIENT  4.1.x, 4.2.x (mailbox over quota, ...), 5.1.x, 5.2.x
    //   TRANSPORT  421, 4.7.x (throttling, "try again later"), 534/535 5.7.x
    //              (authentication), and the "limit exceeded" / "rate limit" /
    //              "try again later" wordings
    //   TRANSIENT  any other 4.x.x: temporary, but not the account's fault
    //   (other 5.x.x: null, the caller decides)
    static EmailSendException.Kind classifyReply(String text) {
        String t = text.toLowerCase(Locale.ROOT);
        Matcher m = REPLY.matcher(t);
        if (m.find()) {
            int code = Integer.parseInt(m.group(1));
            int cls = Integer.parseInt(m.group(2));
            int subject = Integer.parseInt(m.group(3));
            int detail = Integer.parseInt(m.group(4));
            if (cls == 5 && subject == 4 && detail == 5) return EmailSendException.Kind.QUOTA;
            if (code == 421
                    || (cls == 5 && subject == 7 && (code == 534 || code == 535))
                    || (cls == 4 && subject == 7)) {
                return EmailSendException.Kind.TRANSPORT;
            }
            if (subject == 1 || subject == 2) {
                if (cls == 4 || cls == 5) return EmailSendException.Kind.RECIPIENT;
            }
            if (cls == 4) return EmailSendException.Kind.TRANSIENT;
            // Other permanent replies: fall through to the wording check.
        }
        if (t.contains("sending limit exceeded")) return EmailSendException.Kind.QUOTA;
        if (t.contains("limit exceeded") || t.contains("rate limit") || t.contains("try again later")) {
            return EmailSendException.Kind.TRANSPORT;
        }
        return null;
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
