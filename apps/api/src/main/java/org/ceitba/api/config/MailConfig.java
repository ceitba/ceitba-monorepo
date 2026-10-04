package org.ceitba.api.config;

import org.ceitba.api.service.mail.DisabledEmailSender;
import org.ceitba.api.service.mail.EmailSender;
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
// MAIL_ENABLED=true: SMTP through Spring Boot's JavaMailSender (spring.mail.*).
// Otherwise (the default) a sender that refuses (DisabledEmailSender), or, only
// with the dev flag MAIL_LOG_SENDS=true, one that just logs.
// The transport itself is deliberately not a bean, so no caller can bypass
// the quota.
@Configuration
@EnableConfigurationProperties({EmailProperties.class, DigestProperties.class, DigestPersonalProperties.class,
    MailRetentionProperties.class})
public class MailConfig {

    private static final Logger log = LoggerFactory.getLogger(MailConfig.class);

    @Bean
    public MailSendService emailSender(EmailProperties props, DigestProperties digest,
                                       ObjectProvider<JavaMailSender> javaMailSender,
                                       MailLedger ledger, Clock clock) {
        String account = props.account();
        int limit = props.limitFor(account);
        log.info("Mail: sending account {}, {} recipients per rolling 24h", account, limit);
        return new MailSendService(transport(props, javaMailSender), ledger, account, limit,
            props.backoffInitial(), props.backoffMax(), props.quotaPause(), clock, digest::isAllowedRecipient);
    }

    private static EmailSender transport(EmailProperties props, ObjectProvider<JavaMailSender> javaMailSender) {
        if (!props.enabled()) {
            if (props.logSends()) {
                log.warn("Mail: DEV log-only mode (MAIL_LOG_SENDS=true); emails are logged, never sent");
                return new LoggingEmailSender();
            }
            log.info("Mail: disabled (MAIL_ENABLED=false); sending is refused");
            return new DisabledEmailSender();
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
