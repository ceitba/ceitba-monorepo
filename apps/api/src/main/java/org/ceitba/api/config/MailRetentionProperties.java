package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

// How long mail bookkeeping is kept (MailRetentionService, nightly job).
//   sendLog:        mail_send_log rows (MAIL_RETENTION_SEND_LOG, default 30
//                   days). Only the last 24h matter for the sending quota;
//                   the rest is for troubleshooting.
//   trackingEvents: mail_tracking_event rows and the per-delivery link rows of
//                   deliveries sent that long ago (MAIL_RETENTION_TRACKING,
//                   default 180 days). The per-delivery counters
//                   (open_count, click_count, ...) stay, so open/click rates
//                   survive; per-link click stats of older issues do not.
@ConfigurationProperties(prefix = "mail.retention")
public record MailRetentionProperties(Duration sendLog, Duration trackingEvents) {

    public static final Duration DEFAULT_SEND_LOG = Duration.ofDays(30);
    public static final Duration DEFAULT_TRACKING = Duration.ofDays(180);

    public MailRetentionProperties {
        if (sendLog == null || sendLog.compareTo(Duration.ofDays(2)) < 0) sendLog = DEFAULT_SEND_LOG;
        if (trackingEvents == null || trackingEvents.isNegative() || trackingEvents.isZero()) {
            trackingEvents = DEFAULT_TRACKING;
        }
    }
}
