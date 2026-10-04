package org.ceitba.api.service.digest;

import com.fasterxml.jackson.databind.node.TextNode;
import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.digest.DigestIssue;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.digest.DigestDeliveryRepository;
import org.ceitba.api.repository.digest.DigestIssueRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.service.crypto.ContentHmac;
import org.ceitba.api.repository.digest.DigestDeliveryLinkRepository;
import org.ceitba.api.repository.digest.DigestIssueLinkRepository;
import org.ceitba.api.repository.mail.MailTrackingEventRepository;
import org.ceitba.api.service.mail.EmailSender;
import org.ceitba.api.service.mail.InMemoryMailLedger;
import org.ceitba.api.service.mail.MailSendService;
import org.ceitba.api.service.news.FollowService;
import org.ceitba.api.web.digest.dto.DigestDtos;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Decisions that are easy to get wrong: the weekly-draft catch-up window, past
// auto-send times, and "mail disabled never fakes a send". Mocks only; the
// endpoints are covered by DigestEndpointsIT.
class DigestServiceTest {

    static final ZoneId ART = ZoneId.of("America/Argentina/Buenos_Aires");

    final DigestIssueRepository issues = mock(DigestIssueRepository.class);
    final ArticleRepository articles = mock(ArticleRepository.class);
    final EmailSender sender = mock(EmailSender.class);
    OffsetDateTime now;

    DigestService service() {
        var clock = Clock.fixed(now.toInstant(), ART);
        var props = new DigestProperties(null, null, null, null, null, null, false);
        var users = mock(UserRepository.class);
        var tokens = new DigestUnsubscribeTokens(ContentHmac.fromJwtSecret("dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch"));
        var composer = new DigestComposer(articles, mock(NewsEventRepository.class),
            mock(UserFollowRepository.class), users, tokens, (readers, issue) -> java.util.Map.of(), props);
        var follows = new FollowService(mock(UserFollowRepository.class), mock(OrganizationRepository.class), users);
        var deliveries = mock(DigestDeliveryRepository.class);
        var hmac = ContentHmac.fromJwtSecret("dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch");
        var mail = new MailSendService(sender, new InMemoryMailLedger(), "ceitba@itba.edu.ar", 1500,
            Duration.ofMinutes(5), Duration.ofHours(1), Duration.ofHours(24), clock);
        var trackingService = new DigestTrackingService(mock(DigestIssueLinkRepository.class),
            mock(DigestDeliveryLinkRepository.class), deliveries, mock(MailTrackingEventRepository.class),
            props, hmac, clock);
        return new DigestService(issues, deliveries, users, composer, tokens, mail, trackingService,
            follows, props, mock(ApplicationEventPublisher.class), clock);
    }

    @BeforeEach
    void setUp() {
        now = OffsetDateTime.parse("2026-10-05T10:00:00-03:00");
        when(sender.enabled()).thenReturn(true);
    }

    // The week that just ended is 2026-09-28; its draft is auto-sent Monday 12:00 ART.
    @ParameterizedTest
    @CsvSource(nullValues = "none", value = {
        "2026-10-04T23:59:00-03:00, false, none",                  // Sunday
        "2026-10-05T00:04:00-03:00, false, none",                  // before 00:05
        "2026-10-05T00:05:00-03:00, true,  2026-10-05T12:00:00-03:00",
        "2026-10-05T11:59:00-03:00, true,  2026-10-05T12:00:00-03:00",   // catch-up before the send time
        "2026-10-05T12:00:00-03:00, true,  none",                  // catch-up after it: staff send it
        "2026-10-05T23:59:00-03:00, true,  none",
        "2026-10-06T00:00:00-03:00, false, none",                  // Tuesday: a deleted draft stays deleted
        "2026-10-08T12:00:00-03:00, false, none"
    })
    void weeklyDraftIsCreatedOnlyOnMondayAfter0005(String at, boolean created, String autoSendAt) {
        now = OffsetDateTime.parse(at);
        when(issues.existsByWeekStart(any())).thenReturn(false);

        var result = service().createScheduledDraft();

        assertThat(result.isPresent()).isEqualTo(created);
        if (!created) {
            verify(issues, never()).saveAndFlush(any());
            return;
        }
        var saved = ArgumentCaptor.forClass(DigestIssue.class);
        verify(issues).saveAndFlush(saved.capture());
        assertThat(saved.getValue().getWeekStart()).isEqualTo(LocalDate.of(2026, 9, 28));
        if (autoSendAt == null) {
            assertThat(saved.getValue().getAutoSendAt()).isNull();
        } else {
            assertThat(saved.getValue().getAutoSendAt().toInstant()).isEqualTo(OffsetDateTime.parse(autoSendAt).toInstant());
        }
    }

    @Test
    void weeklyDraftIsIdempotent() {
        when(issues.existsByWeekStart(LocalDate.of(2026, 9, 28))).thenReturn(true);
        assertThat(service().createScheduledDraft()).isEmpty();
        verify(issues, never()).saveAndFlush(any());
    }

    @Test
    void autoSendInThePastIsRejectedOnCreateAndPatch() {
        var past = now.minusMinutes(1).toString();
        assertThatThrownBy(() -> service().create(LocalDate.of(2026, 9, 28), past))
            .isInstanceOfSatisfying(DigestException.class,
                e -> assertThat(e.reason()).isEqualTo(DigestException.Reason.AUTO_SEND_IN_PAST));

        var issue = new DigestIssue(UUID.randomUUID(), LocalDate.of(2026, 9, 28), "Asunto");
        when(issues.findByIdForUpdate(issue.getId())).thenReturn(Optional.of(issue));
        var patch = new DigestDtos.PatchRequest(null, null, null, null, new TextNode(past));
        assertThatThrownBy(() -> service().patch(issue.getId(), patch))
            .isInstanceOfSatisfying(DigestException.class,
                e -> assertThat(e.reason()).isEqualTo(DigestException.Reason.AUTO_SEND_IN_PAST));
    }

    @Test
    void patchKeepingTheStoredPastAutoSendAtStillSaves() {
        var week = new DigestWeek(LocalDate.of(2026, 9, 28));
        var issue = new DigestIssue(UUID.randomUUID(), week.weekStart(), "Asunto");
        var stored = now.minusHours(3);
        issue.setAutoSendAt(stored);
        when(issues.findByIdForUpdate(issue.getId())).thenReturn(Optional.of(issue));

        var patch = new DigestDtos.PatchRequest("Nuevo asunto", null, null, null, new TextNode(stored.toString()));

        assertThatCode(() -> service().patch(issue.getId(), patch)).doesNotThrowAnyException();
        assertThat(issue.getSubject()).isEqualTo("Nuevo asunto");
    }

    @Test
    void disabledMailRefusesSendAndTestAndSkipsAutoSend() {
        when(sender.enabled()).thenReturn(false);
        var id = UUID.randomUUID();
        var s = service();

        assertThatThrownBy(() -> s.send(id, UUID.randomUUID())).isInstanceOfSatisfying(DigestException.class,
            e -> assertThat(e.reason()).isEqualTo(DigestException.Reason.MAIL_DISABLED));
        assertThatThrownBy(() -> s.sendTest(id, UUID.randomUUID())).isInstanceOfSatisfying(DigestException.class,
            e -> assertThat(e.reason()).isEqualTo(DigestException.Reason.MAIL_DISABLED));

        when(issues.findDueForAutoSend(any(), any())).thenReturn(List.of(id));
        assertThat(s.startDueAutoSends()).isEmpty();
        verify(issues, never()).findByIdForUpdate(any());
    }
}
