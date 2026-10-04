package org.ceitba.api.service.digest;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.digest.DigestDelivery;
import org.ceitba.api.domain.digest.DigestDeliveryLink;
import org.ceitba.api.domain.digest.DigestIssueLink;
import org.ceitba.api.domain.mail.MailTrackingEvent;
import org.ceitba.api.repository.digest.DigestDeliveryLinkRepository;
import org.ceitba.api.repository.digest.DigestDeliveryRepository;
import org.ceitba.api.repository.digest.DigestIssueLinkRepository;
import org.ceitba.api.repository.mail.MailTrackingEventRepository;
import org.ceitba.api.service.crypto.ContentHmac;
import org.ceitba.api.service.mail.MailClientClass;
import org.ceitba.api.service.mail.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Click redirects resolve only stored URLs (no open redirect); scanners,
// bots and too-early events are recorded but flagged and don't count.
class DigestTrackingServiceTest {

    static final String TID = "AbCdEfGhIjKlMnOpQrStUv";
    static final UUID ISSUE = UUID.randomUUID();
    static final Instant SENT = Instant.parse("2026-10-05T15:00:00Z");
    static final String BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";
    static final String HOME = "https://ceitba.org.ar/newsletter";

    final DigestIssueLinkRepository issueLinks = mock(DigestIssueLinkRepository.class);
    final DigestDeliveryLinkRepository deliveryLinks = mock(DigestDeliveryLinkRepository.class);
    final DigestDeliveryRepository deliveries = mock(DigestDeliveryRepository.class);
    final MailTrackingEventRepository events = mock(MailTrackingEventRepository.class);
    final MutableClock clock = new MutableClock(SENT.plus(Duration.ofMinutes(5)));
    DigestTrackingService service;

    @BeforeEach
    void setUp() {
        var props = new DigestProperties(null, null, null, true, null, null, false);
        service = new DigestTrackingService(issueLinks, deliveryLinks, deliveries, events, props,
            ContentHmac.fromJwtSecret("dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch"), clock);
        var d = new DigestDelivery(ISSUE, UUID.randomUUID(), "a@itba.edu.ar");
        ReflectionTestUtils.setField(d, "sentAt", SENT.atOffset(ZoneOffset.UTC));
        ReflectionTestUtils.setField(d, "trackingId", TID);
        when(deliveries.findByTrackingId(TID)).thenReturn(Optional.of(d));
        when(issueLinks.findById(new DigestIssueLink.Key(ISSUE, 3))).thenReturn(Optional.of(
            new DigestIssueLink(ISSUE, 3, "https://ceitba.org.ar/newsletter/articles/a1", "k", "Título")));
        when(deliveryLinks.findById(new DigestDeliveryLink.Key(TID, 1000))).thenReturn(Optional.of(
            new DigestDeliveryLink(TID, 1000, "https://ceitba.org.ar/newsletter/unsubscribe?token=x", "k", "Baja")));
        when(deliveryLinks.findById(new DigestDeliveryLink.Key(TID, 1001))).thenReturn(Optional.of(
            new DigestDeliveryLink(TID, 1001, "javascript:alert(1)", "k", "x")));
    }

    DigestTrackingService.ClientInfo client(String ua) {
        return new DigestTrackingService.ClientInfo(ua, "GET", "203.0.113.7");
    }

    @Test
    void clicksGoOnlyToStoredUrls() {
        assertThat(service.click(TID, "3", client(BROWSER))).isEqualTo("https://ceitba.org.ar/newsletter/articles/a1");
        assertThat(service.click(TID, "1000", client(BROWSER))).isEqualTo("https://ceitba.org.ar/newsletter/unsubscribe?token=x");
        // Unknown link, unknown/malformed tracking id, junk link id: home.
        assertThat(service.click(TID, "4", client(BROWSER))).isEqualTo(HOME);
        assertThat(service.click("ZZZZZZZZZZZZZZZZZZZZZZ", "3", client(BROWSER))).isEqualTo(HOME);
        assertThat(service.click("../x", "3", client(BROWSER))).isEqualTo(HOME);
        assertThat(service.click(TID, "https:%2F%2Fevil.example", client(BROWSER))).isEqualTo(HOME);
        assertThat(service.click(TID, "-1", client(BROWSER))).isEqualTo(HOME);
        // A stored non-http URL is never redirected to.
        assertThat(service.click(TID, "1001", client(BROWSER))).isEqualTo(HOME);
        // Another delivery's personal link id is looked up under this id only.
        verify(deliveryLinks, never()).findById(new DigestDeliveryLink.Key("ZZZZZZZZZZZZZZZZZZZZZZ", 1000));
    }

    @Test
    void realClickCountsAndImpliesAnOpen() {
        service.click(TID, "3", client(BROWSER));
        var event = ArgumentCaptor.forClass(MailTrackingEvent.class);
        verify(events).save(event.capture());
        assertThat(event.getValue().isFlagged()).isFalse();
        assertThat(event.getValue().getLinkId()).isEqualTo(3);
        assertThat(event.getValue().getUaClass()).isEqualTo("browser");
        verify(deliveries).recordClick(any(), any());
    }

    @Test
    void scannerClickIsRecordedFlaggedAndNotCounted() {
        service.click(TID, "3", client("Mozilla/5.0 Proofpoint URL Defense"));
        var event = ArgumentCaptor.forClass(MailTrackingEvent.class);
        verify(events).save(event.capture());
        assertThat(event.getValue().isFlagged()).isTrue();
        assertThat(event.getValue().getFlagReason()).isEqualTo("scanner");
        verify(deliveries, never()).recordClick(anyString(), any());
    }

    @Test
    void openWithinSecondsOfSendingIsFlagged() {
        clock.set(SENT.plusSeconds(3));
        service.open(TID, client(BROWSER));
        var event = ArgumentCaptor.forClass(MailTrackingEvent.class);
        verify(events).save(event.capture());
        assertThat(event.getValue().getFlagReason()).isEqualTo("early");
        verify(deliveries, never()).recordOpen(anyString(), any());

        clock.set(SENT.plusSeconds(30));
        service.open(TID, client("Mozilla/5.0 (via ggpht.com GoogleImageProxy)"));
        verify(deliveries).recordOpen(any(), any());
    }

    @Test
    void unknownTrackingIdsRecordNothing() {
        service.open("ZZZZZZZZZZZZZZZZZZZZZZ", client(BROWSER));
        service.open("nope", client(BROWSER));
        verify(events, never()).save(any());
    }

    @Test
    void flagRules() {
        var sent = OffsetDateTime.parse("2026-10-05T15:00:00Z");
        var get = new DigestTrackingService.ClientInfo(BROWSER, "GET", null);
        assertThat(DigestTrackingService.flag(MailClientClass.BROWSER, get, sent, sent.plusSeconds(11))).isNull();
        assertThat(DigestTrackingService.flag(MailClientClass.BROWSER, get, sent, sent.plusSeconds(9))).isEqualTo("early");
        assertThat(DigestTrackingService.flag(MailClientClass.BROWSER, get, null, sent)).isEqualTo("early");
        assertThat(DigestTrackingService.flag(MailClientClass.SCANNER, get, sent, sent.plusHours(1))).isEqualTo("scanner");
        var head = new DigestTrackingService.ClientInfo(BROWSER, "HEAD", null);
        assertThat(DigestTrackingService.flag(MailClientClass.BROWSER, head, sent, sent.plusHours(1))).isEqualTo("scanner");
    }

    @Test
    void recordingIsRateLimitedPerTrackingIdButTheRedirectStillWorks() {
        for (int i = 0; i < DigestTrackingService.PER_TRACKING_ID_PER_HOUR + 5; i++) {
            assertThat(service.click(TID, "3", client(BROWSER))).isEqualTo("https://ceitba.org.ar/newsletter/articles/a1");
        }
        verify(events, org.mockito.Mockito.times((int) DigestTrackingService.PER_TRACKING_ID_PER_HOUR)).save(any());
    }

    @Test
    void ratesAreRounded() {
        assertThat(DigestTrackingService.rate(1, 3)).isEqualTo(0.3333);
        assertThat(DigestTrackingService.rate(0, 0)).isNull();
    }
}
