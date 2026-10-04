package org.ceitba.api.config;

import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

// Outgoing email (service/mail). The SMTP connection itself is spring.mail.*
// (MAIL_HOST/PORT/USERNAME/PASSWORD). enabled=false (MAIL_ENABLED, the
// default) wires a logging no-op transport: nothing is ever sent.
// transport (MAIL_TRANSPORT, default gmail-api): gmail-api (OAuth, a connected
// sender account, MailOAuthProperties) | smtp | log. enabled=false = log.
//
// Sending quota (MailSendService, docs/WEEKLY-DIGEST.md):
//   dailyLimit:     recipients per rolling 24h per sending account
//                   (MAIL_DAILY_LIMIT, falling back to the older
//                   DIGEST_DAILY_LIMIT; default 1500, safely under Google
//                   Workspace's ~2000)
//   dailyLimits:    per-account overrides, {address: limit} (yml only)
//   backoffInitial: first pause after a transport error (PT5M), doubled per
//   backoffMax:     consecutive error up to this cap (PT1H)
//   quotaPause:     pause after Gmail's own daily-limit error (PT24H)
@ConfigurationProperties(prefix = "mail")
public record EmailProperties(
    boolean enabled,
    String transport,
    String from,
    Integer dailyLimit,
    Map<String, Integer> dailyLimits,
    Duration backoffInitial,
    Duration backoffMax,
    Duration quotaPause
) {

    public static final String DEFAULT_FROM = "CEITBA <ceitba@itba.edu.ar>";
    public static final int DEFAULT_DAILY_LIMIT = 1500;

    public static final String TRANSPORT_GMAIL_API = "gmail-api";
    public static final String TRANSPORT_SMTP = "smtp";
    public static final String TRANSPORT_LOG = "log";

    public EmailProperties {
        transport = transport == null || transport.isBlank() ? TRANSPORT_GMAIL_API
            : transport.trim().toLowerCase(Locale.ROOT);
        if (!java.util.List.of(TRANSPORT_GMAIL_API, TRANSPORT_SMTP, TRANSPORT_LOG).contains(transport)) {
            throw new IllegalStateException("MAIL_TRANSPORT must be gmail-api, smtp or log, not: " + transport);
        }
        if (from == null || from.isBlank()) from = DEFAULT_FROM;
        if (dailyLimit == null || dailyLimit < 0) dailyLimit = DEFAULT_DAILY_LIMIT;
        var limits = new LinkedHashMap<String, Integer>();
        if (dailyLimits != null) {
            dailyLimits.forEach((k, v) -> {
                if (k != null && v != null && v >= 0) limits.put(k.trim().toLowerCase(Locale.ROOT), v);
            });
        }
        dailyLimits = Map.copyOf(limits);
        if (backoffInitial == null || backoffInitial.isZero() || backoffInitial.isNegative()) {
            backoffInitial = Duration.ofMinutes(5);
        }
        if (backoffMax == null || backoffMax.compareTo(backoffInitial) < 0) {
            backoffMax = backoffInitial.compareTo(Duration.ofHours(1)) > 0 ? backoffInitial : Duration.ofHours(1);
        }
        if (quotaPause == null || quotaPause.isNegative()) quotaPause = Duration.ofHours(24);
    }

    // The sending account: the address part of `from`, lower-cased.
    public String account() {
        try {
            return new InternetAddress(from, true).getAddress().toLowerCase(Locale.ROOT);
        } catch (AddressException e) {
            throw new IllegalStateException("mail.from (MAIL_FROM) is not a valid address: " + from, e);
        }
    }

    public int limitFor(String account) {
        return dailyLimits.getOrDefault(account == null ? "" : account.toLowerCase(Locale.ROOT), dailyLimit);
    }
}
