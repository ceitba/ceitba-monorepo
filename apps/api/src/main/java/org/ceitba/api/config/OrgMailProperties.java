package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.Locale;

// Organizations' emails to their followers (docs/ORGANIZATIONS.md):
//   allowedDomain: the only domain an org may connect a Gmail account from
//                  (ORG_MAIL_ALLOWED_DOMAIN, default itba.edu.ar: the OAuth
//                  consent screen is Internal to that Workspace)
//   dailyLimit:    recipients per rolling 24h per org account (ORG_MAIL_DAILY_LIMIT,
//                  default 400, well under Workspace's per-user Gmail limit;
//                  mail.daily-limits overrides one address)
//   weeklyLimit:   announcements an org may send per rolling 7 days
//                  (ORG_MAIL_WEEKLY_LIMIT, default 3)
@ConfigurationProperties(prefix = "org-mail")
public record OrgMailProperties(String allowedDomain, Integer dailyLimit, Integer weeklyLimit) {

    public OrgMailProperties {
        allowedDomain = allowedDomain == null || allowedDomain.isBlank() ? "itba.edu.ar"
            : allowedDomain.trim().toLowerCase(Locale.ROOT);
        if (dailyLimit == null || dailyLimit < 0) dailyLimit = 400;
        if (weeklyLimit == null || weeklyLimit < 0) weeklyLimit = 3;
    }

    public boolean allows(String email) {
        return email != null && email.toLowerCase(Locale.ROOT).endsWith("@" + allowedDomain);
    }
}
