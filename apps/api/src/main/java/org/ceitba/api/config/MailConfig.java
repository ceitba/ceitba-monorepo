package org.ceitba.api.config;

import org.ceitba.api.service.mail.EmailSender;
import org.ceitba.api.service.mail.GmailApiEmailSender;
import org.ceitba.api.service.mail.GoogleMailOAuthClient;
import org.ceitba.api.service.mail.MailAccessTokenCache;
import org.ceitba.api.service.mail.MailSenderAccountService;
import org.ceitba.api.service.mail.LoggingEmailSender;
import org.ceitba.api.service.mail.MailLedger;
import org.ceitba.api.service.mail.MailSendService;
import org.ceitba.api.service.mail.SmtpEmailSender;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.time.Clock;

// The only EmailSender bean is MailSendService (sending-quota ledger, see
// its class comment), wrapping the transport:
// MAIL_ENABLED=true, MAIL_TRANSPORT (default gmail-api):
//   gmail-api: Gmail API with the OAuth-connected sender account.
//   smtp:      SMTP through Spring Boot's JavaMailSender (spring.mail.*).
//   log:       a logging no-op.
// MAIL_ENABLED=false (the default) = log, so dev and tests never send.
// The transport itself is deliberately not a bean, so no caller can bypass
// the quota.
@Configuration
@EnableConfigurationProperties({EmailProperties.class, DigestProperties.class, DigestPersonalProperties.class,
    MailOAuthProperties.class})
public class MailConfig {

    private static final Logger log = LoggerFactory.getLogger(MailConfig.class);

    @Bean
    public MailSendService emailSender(EmailProperties props, ObjectProvider<JavaMailSender> javaMailSender,
                                       MailLedger ledger, Clock clock, MailSenderAccountService senderAccounts,
                                       GoogleMailOAuthClient googleMail) {
        String account = props.account();
        int limit = props.limitFor(account);
        log.info("Mail: sending account {}, {} recipients per rolling 24h", account, limit);
        return new MailSendService(transport(props, javaMailSender, senderAccounts, googleMail, clock), ledger, account, limit,
            props.backoffInitial(), props.backoffMax(), props.quotaPause(), clock);
    }

    private static EmailSender transport(EmailProperties props, ObjectProvider<JavaMailSender> javaMailSender,
                                         MailSenderAccountService senderAccounts, GoogleMailOAuthClient googleMail,
                                         Clock clock) {
        if (!props.enabled()) {
            log.info("Mail: disabled (MAIL_ENABLED=false); emails are only logged");
            return new LoggingEmailSender();
        }
        if (EmailProperties.TRANSPORT_LOG.equals(props.transport())) {
            log.info("Mail: MAIL_TRANSPORT=log; emails are only logged");
            return new LoggingEmailSender();
        }
        if (EmailProperties.TRANSPORT_GMAIL_API.equals(props.transport())) {
            log.info("Mail: Gmail API (OAuth) enabled, from {}", props.from());
            return new GmailApiEmailSender(senderAccounts, new MailAccessTokenCache(googleMail::refresh, clock), props.from());
        }
        JavaMailSender sender = javaMailSender.getIfAvailable();
        if (sender == null) {
            throw new IllegalStateException("MAIL_ENABLED=true but spring.mail.host (MAIL_HOST) is not set");
        }
        if (sender instanceof JavaMailSenderImpl impl
                && (isBlank(impl.getUsername()) || isBlank(impl.getPassword()))) {
            throw new IllegalStateException("MAIL_ENABLED=true needs MAIL_USERNAME and MAIL_PASSWORD");
        }
        log.info("Mail: SMTP enabled, from {}", props.from());
        return new SmtpEmailSender(sender, props.from());
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
