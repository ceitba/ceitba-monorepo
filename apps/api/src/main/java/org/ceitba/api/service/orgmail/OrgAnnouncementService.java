package org.ceitba.api.service.orgmail;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.config.OrgMailProperties;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.mail.MailSenderAccount;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.orgmail.OrgAnnouncement;
import org.ceitba.api.domain.orgmail.OrgAnnouncementDelivery;
import org.ceitba.api.domain.orgmail.OrgMailOptoutId;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.orgmail.OrgAnnouncementDeliveryRepository;
import org.ceitba.api.repository.orgmail.OrgAnnouncementRepository;
import org.ceitba.api.repository.orgmail.OrgMailOptoutRepository;
import org.ceitba.api.service.mail.EmailSendException;
import org.ceitba.api.service.mail.MailQuotaExhaustedException;
import org.ceitba.api.service.mail.MailSendService;
import org.ceitba.api.service.mail.MailSenderNotConnectedException;
import org.ceitba.api.service.mail.MailSenderAccountService;
import org.ceitba.api.service.mail.OrgMailSenders;
import org.ceitba.api.service.mail.OutgoingEmail;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

// Organizations' emails to their followers (docs/ORGANIZATIONS.md). An admin
// connects the org's Gmail account (MailSenderAccountService.connectOrg),
// writes a draft, sends it to themself as a test, then sends it: the
// recipients (followers who haven't opted out, within the allowed domains)
// are snapshotted as deliveries that OrgAnnouncementSender works through.
// An org sends at most org-mail.weekly-limit announcements per rolling week.
@Service
public class OrgAnnouncementService {

    static final int MAX_SUBJECT = 150;
    static final int MAX_BODY = 20_000;
    static final Duration WEEK = Duration.ofDays(7);

    private final OrgAnnouncementRepository announcements;
    private final OrgAnnouncementDeliveryRepository deliveries;
    private final OrgMailOptoutRepository optouts;
    private final OrganizationRepository orgs;
    private final UserRepository users;
    private final MailSenderAccountService accounts;
    private final OrgMailSenders senders;
    private final OrgMailUnsubscribeTokens tokens;
    private final OrgMailProperties orgMail;
    private final DigestProperties digest;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public OrgAnnouncementService(OrgAnnouncementRepository announcements, OrgAnnouncementDeliveryRepository deliveries,
                                  OrgMailOptoutRepository optouts, OrganizationRepository orgs, UserRepository users,
                                  MailSenderAccountService accounts, OrgMailSenders senders,
                                  OrgMailUnsubscribeTokens tokens, OrgMailProperties orgMail, DigestProperties digest,
                                  ApplicationEventPublisher events, Clock clock) {
        this.announcements = announcements;
        this.deliveries = deliveries;
        this.optouts = optouts;
        this.orgs = orgs;
        this.users = users;
        this.accounts = accounts;
        this.senders = senders;
        this.tokens = tokens;
        this.orgMail = orgMail;
        this.digest = digest;
        this.events = events;
        this.clock = clock;
    }

    // Published (after commit) when an announcement starts sending: wakes the worker.
    public record SendRequested(Long announcementId) {}

    public record AnnouncementView(Long id, String subject, String body, String status, Integer recipientCount,
                                   long sent, long failed, long pending, OffsetDateTime createdAt,
                                   OffsetDateTime sentAt, OffsetDateTime finishedAt) {}

    // The Correo page's header: the connected account, its quota, the
    // weekly cap and how many followers an email would reach now.
    public record MailStatus(MailSenderAccountService.AccountView account, boolean mailEnabled,
                             MailSendService.QuotaStatus quota, int weeklyLimit, long sentThisWeek,
                             long recipientEstimate, String allowedDomain) {}

    @Transactional(readOnly = true)
    public MailStatus status(String org) {
        var o = requireOrg(org);
        var account = accounts.orgAccount(org).orElse(null);
        var sender = account == null ? null : senders.forAccount(account.email(), o.getName());
        return new MailStatus(account, sender == null || sender.enabled(), sender == null ? null : sender.status(),
            orgMail.weeklyLimit(), sentThisWeek(org), recipients(org).size(), orgMail.allowedDomain());
    }

    @Transactional(readOnly = true)
    public List<AnnouncementView> list(String org) {
        requireOrg(org);
        var rows = announcements.findTop50ByOrgSlugOrderByCreatedAtDesc(org);
        var counts = new HashMap<Long, Map<String, Long>>();
        if (!rows.isEmpty()) {
            for (var r : deliveries.countByAnnouncementAndStatus(rows.stream().map(OrgAnnouncement::getId).toList())) {
                counts.computeIfAbsent((Long) r[0], k -> new HashMap<>()).put((String) r[1], (Long) r[2]);
            }
        }
        return rows.stream().map(a -> view(a, counts.getOrDefault(a.getId(), Map.of()))).toList();
    }

    @Transactional
    public AnnouncementView create(String org, String subject, String body, UUID by) {
        requireOrg(org);
        var a = announcements.save(new OrgAnnouncement(org, validSubject(subject), validBody(body), by));
        return view(a, Map.of());
    }

    @Transactional
    public AnnouncementView update(String org, Long id, String subject, String body) {
        var a = announcements.findForUpdate(id, org).orElseThrow(() -> notFound(id));
        if (!OrgAnnouncement.DRAFT.equals(a.getStatus())) throw new OrgMailException(OrgMailException.Reason.NOT_DRAFT);
        if (subject != null) a.setSubject(validSubject(subject));
        if (body != null) a.setBody(validBody(body));
        return view(a, Map.of());
    }

    @Transactional
    public void delete(String org, Long id) {
        var a = announcements.findForUpdate(id, org).orElseThrow(() -> notFound(id));
        if (!OrgAnnouncement.DRAFT.equals(a.getStatus())) throw new OrgMailException(OrgMailException.Reason.NOT_DRAFT);
        announcements.delete(a);
    }

    // The draft as followers will get it, to the admin who asks ("[Prueba]").
    // Synchronous; counts toward the account's quota.
    public void sendTest(String org, Long id, User to) {
        var o = requireOrg(org);
        var a = announcements.findByIdAndOrgSlug(id, org).orElseThrow(() -> notFound(id));
        var sender = senderFor(o);
        var email = email(o, a, to.getId(), to.getEmail(), true);
        try {
            sender.send(email);
        } catch (MailQuotaExhaustedException | MailSenderNotConnectedException e) {
            throw e;
        } catch (EmailSendException e) {
            throw new OrgMailException(OrgMailException.Reason.TEST_FAILED, "The test email failed: " + e.getMessage());
        }
    }

    // draft -> sending, with the recipients snapshot.
    @Transactional
    public AnnouncementView send(String org, Long id) {
        var o = requireOrg(org);
        var a = announcements.findForUpdate(id, org).orElseThrow(() -> notFound(id));
        if (!OrgAnnouncement.DRAFT.equals(a.getStatus())) throw new OrgMailException(OrgMailException.Reason.NOT_DRAFT);
        var sender = senderFor(o);
        if (sentThisWeek(org) >= orgMail.weeklyLimit()) {
            throw new OrgMailException(OrgMailException.Reason.WEEKLY_LIMIT);
        }
        var recipients = recipients(org);
        if (recipients.isEmpty()) throw new OrgMailException(OrgMailException.Reason.NO_RECIPIENTS);
        var rows = new ArrayList<OrgAnnouncementDelivery>(recipients.size());
        recipients.forEach((userId, email) -> rows.add(new OrgAnnouncementDelivery(a.getId(), userId, email)));
        deliveries.saveAll(rows);
        a.startSending(sender.account(), rows.size(), OffsetDateTime.now(clock));
        events.publishEvent(new SendRequested(a.getId()));
        return view(a, Map.of(OrgAnnouncementDelivery.PENDING, (long) rows.size()));
    }

    // ---- worker side (OrgAnnouncementSender)

    // The sender of an announcement's org, or empty when the org lost its account.
    @Transactional(readOnly = true)
    public Optional<MailSendService> senderOf(OrgAnnouncement a) {
        var o = orgs.findById(a.getOrgSlug()).orElse(null);
        if (o == null || a.getSenderEmail() == null) return Optional.empty();
        return Optional.of(senders.forAccount(a.getSenderEmail(), o.getName()));
    }

    // Still follows the org, hasn't opted out and `email` is still allowed.
    public boolean stillRecipient(UUID userId, String email, String org) {
        return digest.isAllowedRecipient(email) && announcements.isStillRecipient(userId, org);
    }

    public OutgoingEmail email(Organization o, OrgAnnouncement a, UUID userId, String to, boolean test) {
        String token = tokens.issue(userId, o.getSlug());
        String unsubscribePage = digest.publicBaseUrl() + "/unsubscribe?kind=org&token=" + enc(token);
        String portal = digest.publicBaseUrl() + "/organizations/" + o.getSlug();
        var out = OrgAnnouncementRenderer.render(o.getName(), o.getColor(), a.getBody(), unsubscribePage, portal);
        var headers = new LinkedHashMap<String, String>();
        // RFC 2369 + RFC 8058 one-click: mail clients POST to the API directly.
        headers.put("List-Unsubscribe", "<" + digest.apiBaseUrl() + "/v1/org-mail/unsubscribe?token=" + enc(token) + ">");
        headers.put("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
        headers.put("List-Id", o.getName().replaceAll("[<>\"]", "") + " <" + o.getSlug() + ".orgs.ceitba.org.ar>");
        if (o.getContactEmail() != null) headers.put("Reply-To", o.getContactEmail());
        if (!test) headers.put("Precedence", "bulk");
        String subject = test ? "[Prueba] " + a.getSubject() : a.getSubject();
        return new OutgoingEmail(to, subject, out.html(), out.text(), headers,
            test ? OutgoingEmail.KIND_TEST : OutgoingEmail.KIND_ORG);
    }

    // ---- opt-outs

    // One-click unsubscribe (public): the org's name; 400 for a bad token.
    @Transactional
    public String unsubscribe(String token) {
        var subject = tokens.verify(token)
            .orElseThrow(() -> new ValidationException("token", null, "is not a valid unsubscribe token"));
        var o = orgs.findById(subject.orgSlug())
            .orElseThrow(() -> new ResourceNotFoundException("Organization", subject.orgSlug()));
        // The user may have deleted their account since: nothing to opt out.
        if (users.existsById(subject.userId())) optouts.insertIfAbsent(subject.userId(), subject.orgSlug());
        return o.getName();
    }

    @Transactional(readOnly = true)
    public boolean receivesMail(UUID userId, String org) {
        return !optouts.existsById(new OrgMailOptoutId(userId, org));
    }

    @Transactional
    public void setReceivesMail(UUID userId, String org, boolean enabled) {
        requireOrg(org);
        if (enabled) optouts.deleteById(new OrgMailOptoutId(userId, org));
        else optouts.insertIfAbsent(userId, org);
    }

    // ---- helpers

    private MailSendService senderFor(Organization o) {
        var account = accounts.orgAccount(o.getSlug())
            .filter(a -> MailSenderAccount.CONNECTED.equals(a.status()))
            .orElseThrow(() -> new OrgMailException(OrgMailException.Reason.NOT_CONNECTED));
        var sender = senders.forAccount(account.email(), o.getName());
        if (!sender.enabled()) throw new OrgMailException(OrgMailException.Reason.MAIL_DISABLED);
        return sender;
    }

    private long sentThisWeek(String org) {
        return announcements.countSentSince(org, OffsetDateTime.now(clock).minus(WEEK));
    }

    // user id -> email, in user id order, filtered by the allowed domains.
    private Map<UUID, String> recipients(String org) {
        var out = new LinkedHashMap<UUID, String>();
        for (var r : announcements.findRecipients(org)) {
            String email = (String) r[1];
            if (digest.isAllowedRecipient(email)) out.put((UUID) r[0], email);
        }
        return out;
    }

    private Organization requireOrg(String org) {
        return orgs.findById(org).orElseThrow(() -> new ResourceNotFoundException("Organization", org));
    }

    private static ResourceNotFoundException notFound(Long id) {
        return new ResourceNotFoundException("OrgAnnouncement", String.valueOf(id));
    }

    private static String validSubject(String s) {
        String v = s == null ? "" : s.strip();
        if (v.isEmpty() || v.length() > MAX_SUBJECT || v.contains("\n") || v.contains("\r")) {
            throw new ValidationException("subject", s, "must be one line of 1-" + MAX_SUBJECT + " characters");
        }
        return v;
    }

    private static String validBody(String s) {
        String v = s == null ? "" : s.strip();
        if (v.isEmpty() || v.length() > MAX_BODY) {
            throw new ValidationException("body", null, "must be 1-" + MAX_BODY + " characters");
        }
        return v;
    }

    private static AnnouncementView view(OrgAnnouncement a, Map<String, Long> c) {
        return new AnnouncementView(a.getId(), a.getSubject(), a.getBody(), a.getStatus(), a.getRecipientCount(),
            c.getOrDefault(OrgAnnouncementDelivery.SENT, 0L), c.getOrDefault(OrgAnnouncementDelivery.FAILED, 0L),
            c.getOrDefault(OrgAnnouncementDelivery.PENDING, 0L) + c.getOrDefault(OrgAnnouncementDelivery.SENDING, 0L),
            a.getCreatedAt(), a.getSentAt(), a.getFinishedAt());
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}
