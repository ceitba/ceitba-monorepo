package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

// Outgoing email (service/mail). The SMTP connection itself is spring.mail.*
// (MAIL_HOST/PORT/USERNAME/PASSWORD). enabled=false (MAIL_ENABLED, the
// default) wires a logging no-op sender: nothing is ever sent.
@ConfigurationProperties(prefix = "mail")
public record EmailProperties(boolean enabled, String from) {

    public static final String DEFAULT_FROM = "CEITBA <ceitba@itba.edu.ar>";

    public EmailProperties {
        if (from == null || from.isBlank()) from = DEFAULT_FROM;
    }
}
