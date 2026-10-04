package org.ceitba.api.service.digest;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bucket;
import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.digest.DigestDeliveryLink;
import org.ceitba.api.domain.digest.DigestIssueLink;
import org.ceitba.api.domain.mail.MailTrackingEvent;
import org.ceitba.api.repository.digest.DigestDeliveryLinkRepository;
import org.ceitba.api.repository.digest.DigestDeliveryRepository;
import org.ceitba.api.repository.digest.DigestIssueLinkRepository;
import org.ceitba.api.repository.mail.MailTrackingEventRepository;
import org.ceitba.api.service.crypto.ContentHmac;
import org.ceitba.api.service.mail.MailClientClass;
import org.ceitba.api.service.mail.MailLinkRewriter;
import org.ceitba.api.service.mail.OutgoingEmail;
import org.ceitba.api.web.digest.dto.DigestDtos;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

// Open and click tracking of the weekly digest (docs/WEEKLY-DIGEST.md):
//   - sending side: the issue's shared links (digest_issue_links, ids < 1000)
//     and each delivery's own links (digest_delivery_links, ids >= 1000);
//     every link of the email body is rewritten to
//     ${DIGEST_API_BASE_URL}/v1/mail/c/{trackingId}/{linkId} and the open
//     pixel ${DIGEST_API_BASE_URL}/v1/mail/o/{trackingId}.gif is appended.
//   - public side: records opens/clicks (flagging scanners, bots and
//     anything within seconds of sending) and resolves a click to its
//     stored URL only (never from the request: no open redirect).
//   - aggregate stats per issue; never per person.
@Service
public class DigestTrackingService {

    // Opens/clicks this soon after the email was sent are security scanners
    // or prefetchers, not people.
    static final Duration MIN_AFTER_SEND = Duration.ofSeconds(10);
    // What gets recorded (the endpoints always answer): per client address
    // (Gmail's image proxy fetches for many readers from few addresses) and
    // per tracking id (a reader reloading the email).
    static final long PER_CLIENT_PER_MINUTE = 600;
    static final long PER_TRACKING_ID_PER_HOUR = 30;

    public record ClientInfo(String userAgent, String method, String ip) {}

    public record Tracked(OutgoingEmail email, List<MailLinkRewriter.Link> personalLinks) {}

    private final DigestIssueLinkRepository issueLinks;
    private final DigestDeliveryLinkRepository deliveryLinks;
    private final DigestDeliveryRepository deliveries;
    private final MailTrackingEventRepository events;
    private final DigestProperties props;
    private final ContentHmac hmac;
    private final Clock clock;
    private final Cache<String, Bucket> clientBuckets = Caffeine.newBuilder()
        .maximumSize(100_000).expireAfterAccess(Duration.ofMinutes(2)).build();
    private final Cache<String, Bucket> trackingBuckets = Caffeine.newBuilder()
        .maximumSize(100_000).expireAfterAccess(Duration.ofHours(2)).build();

    public DigestTrackingService(DigestIssueLinkRepository issueLinks, DigestDeliveryLinkRepository deliveryLinks,
                                 DigestDeliveryRepository deliveries, MailTrackingEventRepository events,
                                 DigestProperties props, ContentHmac hmac, Clock clock) {
        this.issueLinks = issueLinks;
        this.deliveryLinks = deliveryLinks;
        this.deliveries = deliveries;
        this.events = events;
        this.props = props;
        this.hmac = hmac;
        this.clock = clock;
    }

    public boolean enabled() {
        return props.trackingEnabled();
    }

    // Where unknown clicks go: the newsletter home.
    public String fallbackUrl() {
        return props.publicBaseUrl();
    }

    // ------------------------------------------------------------ sending side

    // URL -> link id of the links every email of the issue shares (those of
    // the shared template body). Stored once; links that appear later (the
    // content of a sending issue is re-read each run) get the next ids.
    @Transactional
    public Map<String, Integer> issueLinks(UUID issueId, DigestRenderer.Template template) {
        var existing = issueLinks.findByIssueIdOrderByLinkIdAsc(issueId);
        var map = new LinkedHashMap<String, Integer>();
        int max = 0;
        for (var l : existing) {
            map.put(l.getUrl(), l.getLinkId());
            max = Math.max(max, l.getLinkId());
        }
        for (var link : MailLinkRewriter.collect(template.htmlBody(), template.textBody())) {
            if (map.containsKey(link.url())) continue;
            if (max + 1 >= MailLinkRewriter.PERSONAL_BASE) break;   // absurdly many links: the rest are per delivery
            int id = ++max;
            issueLinks.save(new DigestIssueLink(issueId, id, link.url(), link.urlKey(), link.label()));
            map.put(link.url(), id);
        }
        return map;
    }

    // The email with every body link wrapped and the pixel appended (pure).
    public Tracked track(OutgoingEmail email, String trackingId, Map<String, Integer> shared) {
        String base = props.apiBaseUrl() + "/v1/mail";
        var r = MailLinkRewriter.rewrite(email.html(), email.text(), shared,
            id -> base + "/c/" + trackingId + "/" + id, base + "/o/" + trackingId + ".gif");
        return new Tracked(email.withBody(r.html(), r.text()), r.personalLinks());
    }

    // Replaces the per-reader links of a delivery (inside its send transaction).
    public void saveDeliveryLinks(String trackingId, Collection<MailLinkRewriter.Link> links) {
        deliveryLinks.deleteByTrackingId(trackingId);
        deliveryLinks.saveAll(links.stream()
            .map(l -> new DigestDeliveryLink(trackingId, l.id(), l.url(), l.urlKey(), l.label()))
            .toList());
    }

    // ------------------------------------------------------------ public side

    // Pixel fetch. Unknown ids and over-limit clients are ignored.
    @Transactional
    public void open(String trackingId, ClientInfo client) {
        if (!MailLinkRewriter.isWellFormedTrackingId(trackingId) || !admit(trackingId, client)) return;
        var delivery = deliveries.findByTrackingId(trackingId).orElse(null);
        if (delivery == null) return;
        var now = OffsetDateTime.now(clock);
        var cls = MailClientClass.of(client.userAgent());
        String flag = flag(cls, client, delivery.getSentAt(), now);
        events.save(new MailTrackingEvent(trackingId, MailTrackingEvent.OPEN, null, now, flag, cls.db()));
        if (flag == null) deliveries.recordOpen(trackingId, now);
    }

    // Click redirect target: the stored URL of that link of that delivery, or
    // the newsletter home for anything unknown. Never a URL from the request.
    @Transactional
    public String click(String trackingId, String linkId, ClientInfo client) {
        String fallback = fallbackUrl();
        if (!MailLinkRewriter.isWellFormedTrackingId(trackingId)) return fallback;
        Integer id = parseLinkId(linkId);
        if (id == null) return fallback;
        var delivery = deliveries.findByTrackingId(trackingId).orElse(null);
        if (delivery == null) return fallback;
        Optional<String> url = id < MailLinkRewriter.PERSONAL_BASE
            ? issueLinks.findById(new DigestIssueLink.Key(delivery.getIssueId(), id)).map(DigestIssueLink::getUrl)
            : deliveryLinks.findById(new DigestDeliveryLink.Key(trackingId, id)).map(DigestDeliveryLink::getUrl);
        if (url.isEmpty() || !isHttp(url.get())) return fallback;
        if (admit(trackingId, client)) {
            var now = OffsetDateTime.now(clock);
            var cls = MailClientClass.of(client.userAgent());
            String flag = flag(cls, client, delivery.getSentAt(), now);
            events.save(new MailTrackingEvent(trackingId, MailTrackingEvent.CLICK, id, now, flag, cls.db()));
            if (flag == null) deliveries.recordClick(trackingId, now);
        }
        return url.get();
    }

    // Why an event does not count (null = it does): a scanner/bot client, a
    // HEAD request, or too soon after sending (or before it was committed).
    static String flag(MailClientClass cls, ClientInfo client, OffsetDateTime sentAt, OffsetDateTime now) {
        if (cls.isScanner() || "HEAD".equalsIgnoreCase(client.method())) return "scanner";
        if (sentAt == null || now.isBefore(sentAt.plus(MIN_AFTER_SEND))) return "early";
        return null;
    }

    private boolean admit(String trackingId, ClientInfo client) {
        String ipKey = client.ip() == null ? "?" : hmac.signHex(ContentHmac.MAIL_TRACKING_IP, client.ip());
        var perClient = clientBuckets.get(ipKey, k -> Bucket.builder()
            .addLimit(l -> l.capacity(PER_CLIENT_PER_MINUTE).refillGreedy(PER_CLIENT_PER_MINUTE, Duration.ofMinutes(1)))
            .build());
        if (!perClient.tryConsume(1)) return false;
        var perId = trackingBuckets.get(trackingId, k -> Bucket.builder()
            .addLimit(l -> l.capacity(PER_TRACKING_ID_PER_HOUR).refillGreedy(PER_TRACKING_ID_PER_HOUR, Duration.ofHours(1)))
            .build());
        return perId.tryConsume(1);
    }

    private static Integer parseLinkId(String s) {
        if (s == null || s.isEmpty() || s.length() > 6 || !s.chars().allMatch(Character::isDigit)) return null;
        return Integer.parseInt(s);
    }

    private static boolean isHttp(String url) {
        String u = url.toLowerCase(java.util.Locale.ROOT);
        return u.startsWith("https://") || u.startsWith("http://");
    }

    // ------------------------------------------------------------ stats

    public record Engagement(long delivered, long opened, long clicked) {
        static final Engagement ZERO = new Engagement(0, 0, 0);

        public Double openRate() { return rate(opened, delivered); }
        public Double clickRate() { return rate(clicked, delivered); }
    }

    @Transactional(readOnly = true)
    public Map<UUID, Engagement> engagement(List<UUID> issueIds) {
        if (issueIds.isEmpty()) return Map.of();
        var out = new HashMap<UUID, Engagement>();
        for (Object[] row : deliveries.engagementByIssue(issueIds)) {
            out.put((UUID) row[0], new Engagement(num(row[1]), num(row[2]), num(row[3])));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public DigestDtos.Stats stats(UUID issueId) {
        var e = engagement(List.of(issueId)).getOrDefault(issueId, Engagement.ZERO);
        var links = events.clicksByLink(issueId).stream()
            .map(r -> new DigestDtos.LinkClicks((String) r[1], (String) r[0], num(r[2]), num(r[3])))
            .toList();
        var hours = deliveries.firstOpensByHour(issueId).stream()
            .map(r -> new DigestDtos.HourCount(
                Instant.ofEpochSecond(num(r[0])).atZone(ClockConfig.ZONE).toOffsetDateTime(), num(r[1])))
            .toList();
        return new DigestDtos.Stats(e.delivered(), e.opened(), e.openRate(), e.clicked(), e.clickRate(), links, hours);
    }

    static Double rate(long part, long whole) {
        if (whole <= 0) return null;
        return Math.round(part * 10000.0 / whole) / 10000.0;
    }

    private static long num(Object o) {
        return o == null ? 0 : ((Number) o).longValue();
    }
}
