package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

// Outgoing email (service/mail). The SMTP connection itself is spring.mail.*
// (MAIL_HOST/PORT/USERNAME/PASSWORD).
//   enabled:  MAIL_ENABLED. false (the default) = nothing can be sent.
//   logSends: MAIL_LOG_SENDS, DEV ONLY. With enabled=false, sends are only
//             logged (masked addresses) and reported as successful, so the
//             digest flow can be exercised locally. Ignored when enabled.
@ConfigurationProperties(prefix = "mail")
public record EmailProperties(boolean enabled, String from, boolean logSends) {

    public static final String DEFAULT_FROM = "CEITBA <ceitba@itba.edu.ar>";

    public EmailProperties {
        if (from == null || from.isBlank()) from = DEFAULT_FROM;
    }
}
