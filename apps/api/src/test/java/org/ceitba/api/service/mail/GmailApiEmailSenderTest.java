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
    void quotaErrorsPauseTheAccount() {
        assertThat(kind(429, "{}")).isEqualTo(EmailSendException.Kind.QUOTA);
        for (String reason : new String[] {"rateLimitExceeded", "dailyLimitExceeded", "userRateLimitExceeded"}) {
            assertThat(kind(403, "{\"error\":{\"code\":403,\"errors\":[{\"reason\":\"" + reason + "\"}]}}"))
                .as(reason).isEqualTo(EmailSendException.Kind.QUOTA);
        }
        assertThat(kind(403, "{\"error\":{\"status\":\"RESOURCE_EXHAUSTED\"}}")).isEqualTo(EmailSendException.Kind.QUOTA);
    }

    @Test
    void authErrorsAreTransientAndFlagTheConnectionAsBroken() {
        var unauthorized = GmailApiEmailSender.classify(401, "{\"error\":{\"status\":\"UNAUTHENTICATED\"}}");
        assertThat(unauthorized.exception().kind()).isEqualTo(EmailSendException.Kind.TRANSIENT);
        assertThat(unauthorized.authProblem()).isTrue();
        var forbidden = GmailApiEmailSender.classify(403, "{\"error\":{\"errors\":[{\"reason\":\"insufficientPermissions\"}]}}");
        assertThat(forbidden.exception().kind()).isEqualTo(EmailSendException.Kind.TRANSIENT);
        assertThat(forbidden.authProblem()).isTrue();
    }

    @Test
    void serverErrorsAreTransientAndBadRecipientIsRecipient() {
        assertThat(kind(500, "")).isEqualTo(EmailSendException.Kind.TRANSIENT);
        assertThat(kind(503, "not json")).isEqualTo(EmailSendException.Kind.TRANSIENT);
        assertThat(GmailApiEmailSender.classify(503, "").authProblem()).isFalse();
        assertThat(kind(400, "{\"error\":{\"errors\":[{\"reason\":\"invalidArgument\"}],\"message\":\"Invalid To header\"}}"))
            .isEqualTo(EmailSendException.Kind.RECIPIENT);
        // Unknown 4xx: never drop a delivery on an error we do not understand.
        assertThat(kind(404, "")).isEqualTo(EmailSendException.Kind.TRANSIENT);
    }

    private static EmailSendException.Kind kind(int status, String body) {
        return GmailApiEmailSender.classify(status, body).exception().kind();
    }
}
