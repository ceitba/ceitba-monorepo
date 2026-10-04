package org.ceitba.api.service.mail;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Date;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;

import static org.ceitba.api.service.mail.EmailSendException.Kind;
import static org.ceitba.api.service.mail.GoogleMailOAuthClient.GoogleOAuthException;

// Gmail API transport (users.messages.send over HTTPS) with the refresh token
// of the connected sender account: no app password, no SMTP. The message is
// the same multipart/alternative RFC 822 one SmtpEmailSender builds, sent as
// base64url `raw`.
//
// Errors (classify): 429 / rateLimitExceeded / dailyLimitExceeded /
// userRateLimitExceeded = QUOTA (MailSendService pauses the account 24h);
// 401, 403 and invalid_grant = TRANSIENT and the account is marked broken
// (reconnect needed); 5xx and network errors = TRANSIENT (backoff); 400 =
// RECIPIENT (rejected message/address). Everything else is TRANSIENT: never
// drop a delivery on an error we do not understand.
public class GmailApiEmailSender implements EmailSender {

    static final String SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
    private static final Set<String> QUOTA_REASONS =
        Set.of("ratelimitexceeded", "dailylimitexceeded", "userratelimitexceeded");

    record Classified(EmailSendException exception, boolean authProblem) {}

    private final MailSenderAccountService accounts;
    private final MailAccessTokenCache tokens;
    private final InternetAddress from;
    private final RestClient http;
    private final String sendUrl;

    public GmailApiEmailSender(MailSenderAccountService accounts, MailAccessTokenCache tokens, String from) {
        this(accounts, tokens, from, defaultClient(), SEND_URL);
    }

    GmailApiEmailSender(MailSenderAccountService accounts, MailAccessTokenCache tokens, String from,
                        RestClient http, String sendUrl) {
        this.accounts = accounts;
        this.tokens = tokens;
        this.http = http;
        this.sendUrl = sendUrl;
        try {
            this.from = new InternetAddress(from, true);
        } catch (MessagingException e) {
            throw new IllegalStateException("mail.from (MAIL_FROM) is not a valid address: " + from, e);
        }
    }

    private static RestClient defaultClient() {
        var f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(Duration.ofSeconds(5));
        f.setReadTimeout(Duration.ofSeconds(20));
        return RestClient.builder().requestFactory(f).build();
    }

    @Override
    public void send(OutgoingEmail email) {
        var creds = accounts.credentialsFor(from.getAddress()).orElseThrow(() ->
            new MailSenderNotConnectedException("No connected Gmail sender account for " + from.getAddress()
                + " (connect it from the digests admin page)"));
        String body = "{\"raw\":\"" + raw(email) + "\"}";
        // One retry on 401: the cached access token may have been revoked early.
        for (int attempt = 0; ; attempt++) {
            String access = accessToken(creds);
            try {
                http.post().uri(sendUrl)
                    .header("Authorization", "Bearer " + access)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve().toBodilessEntity();
                accounts.markUsed(creds);
                return;
            } catch (RestClientResponseException e) {
                var c = classify(e.getStatusCode().value(), e.getResponseBodyAsString());
                if (e.getStatusCode().value() == 401 && attempt == 0) {
                    tokens.invalidate(creds);
                    continue;
                }
                if (c.authProblem()) accounts.markBroken(creds, c.exception().getMessage());
                throw c.exception();
            } catch (RestClientException e) {
                throw new EmailSendException(Kind.TRANSIENT, "Gmail API unreachable: " + e.getClass().getSimpleName(), e);
            }
        }
    }

    private String accessToken(MailSenderAccountService.Credentials creds) {
        try {
            return tokens.get(creds);
        } catch (GoogleOAuthException e) {
            if (e.kind() == GoogleOAuthException.Kind.INVALID_GRANT) {
                accounts.markBroken(creds, "Google rejected the stored token (invalid_grant): reconnect the account");
                throw new EmailSendException(Kind.TRANSIENT,
                    "Gmail authorization was revoked or expired (invalid_grant); reconnect the sender account", e);
            }
            throw new EmailSendException(Kind.TRANSIENT, "Could not get a Gmail access token: " + e.getMessage(), e);
        }
    }

    // ------------------------------------------------------------- MIME

    // base64url (no padding) of the RFC 822 message.
    String raw(OutgoingEmail email) {
        try {
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mime(email));
        } catch (MessagingException | IOException e) {
            throw new EmailSendException(Kind.RECIPIENT, "Could not build the message: " + e.getMessage(), e);
        }
    }

    byte[] mime(OutgoingEmail email) throws MessagingException, IOException {
        String domain = from.getAddress().substring(from.getAddress().indexOf('@') + 1);
        var message = new MimeMessage(Session.getInstance(new Properties())) {
            @Override
            protected void updateMessageID() throws MessagingException {
                setHeader("Message-ID", "<" + UUID.randomUUID() + "@" + domain + ">");
            }
        };
        var helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
        helper.setFrom(from);
        helper.setTo(new InternetAddress(email.to(), true));
        helper.setSubject(email.subject());
        helper.setText(email.text(), email.html());
        helper.setSentDate(new Date());
        for (var h : email.headers().entrySet()) {
            message.setHeader(h.getKey(), h.getValue());
        }
        var out = new ByteArrayOutputStream();
        message.writeTo(out);
        return out.toByteArray();
    }

    // ------------------------------------------------------ error mapping

    static Classified classify(int status, String body) {
        var reasons = reasons(body);
        boolean quota = status == 429 || reasons.stream().anyMatch(r -> QUOTA_REASONS.contains(r.toLowerCase()))
            || reasons.contains("RESOURCE_EXHAUSTED");
        String detail = "Gmail API HTTP " + status + (reasons.isEmpty() ? "" : " " + String.join(",", reasons));
        if (quota) return new Classified(new EmailSendException(Kind.QUOTA, detail, null), false);
        if (status == 401 || status == 403) {
            return new Classified(new EmailSendException(Kind.TRANSIENT, detail + " (authorization problem)", null), true);
        }
        if (status == 400) return new Classified(new EmailSendException(Kind.RECIPIENT, detail, null), false);
        return new Classified(new EmailSendException(Kind.TRANSIENT, detail, null), false);
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();

    // error.errors[].reason and error.status of Google's error body.
    private static java.util.List<String> reasons(String body) {
        var out = new java.util.ArrayList<String>();
        try {
            JsonNode err = MAPPER.readTree(body == null ? "" : body).path("error");
            for (JsonNode e : err.path("errors")) {
                if (e.hasNonNull("reason")) out.add(e.get("reason").asText());
            }
            if (err.hasNonNull("status")) out.add(err.get("status").asText());
        } catch (IOException | RuntimeException ignored) {
            // not JSON: the HTTP status decides
        }
        return out;
    }
}
