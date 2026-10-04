package org.ceitba.api.service.mail;

import org.ceitba.api.config.MailRetentionProperties;
import org.ceitba.api.repository.digest.DigestDeliveryLinkRepository;
import org.ceitba.api.repository.mail.MailSendLogRepository;
import org.ceitba.api.repository.mail.MailTrackingEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;

// Daily cleanup of mail bookkeeping (docs/WEEKLY-DIGEST.md, "Retention"):
//   - mail_tracking_event older than mail.retention.tracking-events (180 d)
//   - digest_delivery_links of deliveries sent that long ago (their clicks
//     then go to the newsletter home; the shared issue links stay)
//   - mail_send_log older than mail.retention.send-log (30 d). The sending
//     quota only ever looks at the last 24h (MailSendService.WINDOW), and the
//     minimum configurable retention is 2 days, so it never reads what is
//     deleted here.
@Service
public class MailRetentionService {

    private static final Logger log = LoggerFactory.getLogger(MailRetentionService.class);

    private final MailTrackingEventRepository events;
    private final DigestDeliveryLinkRepository deliveryLinks;
    private final MailSendLogRepository sendLog;
    private final MailRetentionProperties props;
    private final Clock clock;

    public MailRetentionService(MailTrackingEventRepository events, DigestDeliveryLinkRepository deliveryLinks,
                                MailSendLogRepository sendLog, MailRetentionProperties props, Clock clock) {
        this.events = events;
        this.deliveryLinks = deliveryLinks;
        this.sendLog = sendLog;
        this.props = props;
        this.clock = clock;
    }

    @Transactional
    public void cleanup() {
        var now = OffsetDateTime.now(clock);
        var trackingCutoff = now.minus(props.trackingEvents());
        int e = events.deleteOlderThan(trackingCutoff);
        int l = deliveryLinks.deleteOfDeliveriesSentBefore(trackingCutoff);
        int s = sendLog.deleteOlderThan(now.minus(props.sendLog()));
        log.info("Mail retention: deleted {} tracking events, {} delivery links, {} send-log rows", e, l, s);
    }
}
