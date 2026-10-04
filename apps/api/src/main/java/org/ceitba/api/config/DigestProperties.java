package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.List;
import java.util.Locale;

// Weekly digest email (docs/WEEKLY-DIGEST.md).
//   publicBaseUrl: ItbaNews origin + base path, for article/unsubscribe links
//   apiBaseUrl:    public API base (context path included), for List-Unsubscribe
//   allowedDomains: HARD guard; no digest email (test sends included) ever
//                   goes to an address outside these domains
//   trackingEnabled: open pixel + click redirects in sent issues (the
//                   sending quota itself is mail.daily-limit, EmailProperties)
//   sendInterval:  pause between two emails (throttling)
//   tickInterval:  how often due auto-sends start and stalled sends resume
//   jobsEnabled:   scheduled jobs (weekly draft, auto-send, sending worker)
@ConfigurationProperties(prefix = "digest")
public record DigestProperties(
    String publicBaseUrl,
    String apiBaseUrl,
    List<String> allowedDomains,
    Boolean trackingEnabled,
    Duration sendInterval,
    Duration tickInterval,
    Boolean jobsEnabled
) {

    public DigestProperties {
        publicBaseUrl = stripSlash(publicBaseUrl == null || publicBaseUrl.isBlank()
            ? "https://ceitba.org.ar/newsletter" : publicBaseUrl);
        apiBaseUrl = stripSlash(apiBaseUrl == null || apiBaseUrl.isBlank()
            ? "https://ceitba.org.ar/api" : apiBaseUrl);
        allowedDomains = allowedDomains == null || allowedDomains.stream().allMatch(d -> d == null || d.isBlank())
            ? List.of("itba.edu.ar")
            : allowedDomains.stream()
                .filter(d -> d != null && !d.isBlank())
                .map(d -> d.trim().toLowerCase(Locale.ROOT).replaceFirst("^@", ""))
                .toList();
        if (trackingEnabled == null) trackingEnabled = true;
        if (sendInterval == null || sendInterval.isNegative()) sendInterval = Duration.ofSeconds(1);
        if (tickInterval == null || tickInterval.isZero() || tickInterval.isNegative()) tickInterval = Duration.ofMinutes(5);
        if (jobsEnabled == null) jobsEnabled = true;
    }

    // Exact domain match on the address's domain part (case-insensitive).
    public boolean isAllowedRecipient(String email) {
        if (email == null) return false;
        String e = email.trim().toLowerCase(Locale.ROOT);
        int at = e.lastIndexOf('@');
        if (at <= 0 || at != e.indexOf('@') || at == e.length() - 1) return false;
        String domain = e.substring(at + 1);
        return allowedDomains.contains(domain);
    }

    private static String stripSlash(String s) {
        return s.trim().replaceAll("/+$", "");
    }
}
