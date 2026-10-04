package org.ceitba.api.service.mail;

import jakarta.mail.Multipart;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.util.Base64;
import java.util.Map;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

class GmailApiEmailSenderTest {

    private final GmailApiEmailSender sender =
        new GmailApiEmailSender(null, null, "CEITBA <ceitba@itba.edu.ar>");

    @Test
    void rawIsBase64UrlMimeWithHeadersUtf8SubjectAndBothBodies() throws Exception {
        var email = new OutgoingEmail("ana@itba.edu.ar", "La semana en ITBA: café ñandú 🎓",
            "<p>Hola ñ</p>", "Hola ñ",
            Map.of("List-Unsubscribe", "<https://ceitba.org.ar/api/v1/digests/unsubscribe?token=t>",
                "List-Unsubscribe-Post", "List-Unsubscribe=One-Click",
                "List-Id", "La semana en ITBA <digest.ceitba.itba.edu.ar>",
                "Precedence", "bulk"), "digest");

        String raw = sender.raw(email);

        assertThat(raw).doesNotContain("+", "/", "=");   // base64url, unpadded
        var msg = new MimeMessage(Session.getInstance(new Properties()),
            new ByteArrayInputStream(Base64.getUrlDecoder().decode(raw)));
        assertThat(msg.getSubject()).isEqualTo("La semana en ITBA: café ñandú 🎓");
        assertThat(msg.getFrom()[0].toString()).contains("ceitba@itba.edu.ar");
        assertThat(msg.getAllRecipients()[0].toString()).isEqualTo("ana@itba.edu.ar");
        assertThat(msg.getHeader("List-Unsubscribe", null)).startsWith("<https://ceitba.org.ar/api/v1/digests/unsubscribe");
        assertThat(msg.getHeader("List-Unsubscribe-Post", null)).isEqualTo("List-Unsubscribe=One-Click");
        assertThat(msg.getHeader("List-Id", null)).contains("digest.ceitba.itba.edu.ar");
        assertThat(msg.getHeader("Precedence", null)).isEqualTo("bulk");
        assertThat(msg.getHeader("Message-ID", null)).endsWith("@itba.edu.ar>");
        // multipart/mixed > multipart/related > multipart/alternative (Spring's helper): find both leaves.
        assertThat(leaves((Multipart) msg.getContent(), new StringBuilder()).toString())
            .contains("text/plain").contains("text/html").contains("Hola ñ");
    }

    private static StringBuilder leaves(Multipart mp, StringBuilder out) throws Exception {
        for (int i = 0; i < mp.getCount(); i++) {
            var part = mp.getBodyPart(i);
            if (part.getContent() instanceof Multipart inner) leaves(inner, out);
            else out.append(part.getContentType()).append('|').append(part.getContent()).append('\n');
        }
        return out;
    }

    @Test
    void onlyTheDailyLimitIsQuotaAndPausesTheAccount() {
        assertThat(kind(403, err("dailyLimitExceeded", "Daily Limit Exceeded", "")))
            .isEqualTo(EmailSendException.Kind.QUOTA);
        assertThat(kind(429, err("", "Daily user sending quota exceeded", "RESOURCE_EXHAUSTED")))
            .isEqualTo(EmailSendException.Kind.QUOTA);
    }

    @Test
    void perSecondThrottlingIsTransportWithAShortBackoffHonouringRetryAfter() {
        for (var c : new Object[][] {{429, "{}"}, {403, err("rateLimitExceeded", "Rate Limit Exceeded", "")},
                {403, err("userRateLimitExceeded", "User-rate limit exceeded", "")},
                {429, err("", "Too many requests", "RESOURCE_EXHAUSTED")}}) {
            var e = GmailApiEmailSender.classify((int) c[0], (String) c[1]).exception();
            assertThat(e.kind()).as(c[1].toString()).isEqualTo(EmailSendException.Kind.TRANSPORT);
            assertThat(e.retryAfter()).isEqualTo(GmailApiEmailSender.DEFAULT_RATE_BACKOFF);
        }
        var hinted = GmailApiEmailSender.classify(429, "{}", "7").exception();
        assertThat(hinted.retryAfter()).isEqualTo(java.time.Duration.ofSeconds(7));
        // Absurd hints are capped; the pause itself is capped again by MailSendService.
        assertThat(GmailApiEmailSender.classify(429, "{}", "86400").exception().retryAfter())
            .isEqualTo(java.time.Duration.ofMinutes(10));
    }

    @Test
    void authErrorsAreTransportAndFlagTheConnectionAsBroken() {
        var unauthorized = GmailApiEmailSender.classify(401, "{\"error\":{\"status\":\"UNAUTHENTICATED\"}}");
        assertThat(unauthorized.exception().kind()).isEqualTo(EmailSendException.Kind.TRANSPORT);
        assertThat(unauthorized.authProblem()).isTrue();
        var forbidden = GmailApiEmailSender.classify(403, err("insufficientPermissions", "Insufficient Permission", ""));
        assertThat(forbidden.exception().kind()).isEqualTo(EmailSendException.Kind.TRANSPORT);
        assertThat(forbidden.exception().retryAfter()).isNull();
        assertThat(forbidden.authProblem()).isTrue();
    }

    @Test
    void serverErrorsAreTransportBadRecipientIsRecipientOtherClientErrorsAreTransient() {
        assertThat(kind(500, "")).isEqualTo(EmailSendException.Kind.TRANSPORT);
        assertThat(kind(503, "not json")).isEqualTo(EmailSendException.Kind.TRANSPORT);
        assertThat(GmailApiEmailSender.classify(503, "").authProblem()).isFalse();
        assertThat(kind(400, err("invalidArgument", "Invalid To header", "")))
            .isEqualTo(EmailSendException.Kind.RECIPIENT);
        assertThat(kind(400, err("invalidArgument", "Recipient address required", "")))
            .isEqualTo(EmailSendException.Kind.RECIPIENT);
        // Other per-message 4xx: retried a few times, the account is not paused.
        assertThat(kind(400, err("invalidArgument", "Invalid value for ByteString", "")))
            .isEqualTo(EmailSendException.Kind.TRANSIENT);
        assertThat(kind(404, "")).isEqualTo(EmailSendException.Kind.TRANSIENT);
        assertThat(kind(413, "")).isEqualTo(EmailSendException.Kind.TRANSIENT);
    }

    private static String err(String reason, String message, String status) {
        return "{\"error\":{\"message\":\"" + message + "\""
            + (reason.isEmpty() ? "" : ",\"errors\":[{\"reason\":\"" + reason + "\"}]")
            + (status.isEmpty() ? "" : ",\"status\":\"" + status + "\"") + "}}";
    }

    private static EmailSendException.Kind kind(int status, String body) {
        return GmailApiEmailSender.classify(status, body).exception().kind();
    }
}
