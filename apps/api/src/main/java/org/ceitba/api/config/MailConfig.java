package org.ceitba.api.config;

import org.ceitba.api.service.mail.EmailSender;
import org.ceitba.api.service.mail.LoggingEmailSender;
import org.ceitba.api.service.mail.SmtpEmailSender;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

// MAIL_ENABLED=true: SMTP through Spring Boot's JavaMailSender (spring.mail.*).
// Otherwise (the default) a logging no-op, so dev and tests never send.
@Configuration
@EnableConfigurationProperties({EmailProperties.class, DigestProperties.class, DigestPersonalProperties.class})
public class MailConfig {

    private static final Logger log = LoggerFactory.getLogger(MailConfig.class);

    @Bean
    public EmailSender emailSender(EmailProperties props, ObjectProvider<JavaMailSender> javaMailSender) {
        if (!props.enabled()) {
            log.info("Mail: disabled (MAIL_ENABLED=false); emails are only logged");
            return new LoggingEmailSender();
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
