package org.ceitba.api.service.mail;

import java.util.Map;

// One email to one recipient: an HTML body with its plain-text alternative,
// plus extra headers (e.g. List-Unsubscribe). `kind` labels the attempt in
// the sending-quota ledger (mail_send_log): digest | test | ... .
public record OutgoingEmail(String to, String subject, String html, String text, Map<String, String> headers,
                            String kind) {

    public static final String KIND_OTHER = "other";
    public static final String KIND_DIGEST = "digest";
    public static final String KIND_TEST = "test";

    public OutgoingEmail {
        headers = headers == null ? Map.of() : Map.copyOf(headers);
        kind = kind == null || kind.isBlank() ? KIND_OTHER : kind;
    }

    public OutgoingEmail(String to, String subject, String html, String text, Map<String, String> headers) {
        this(to, subject, html, text, headers, KIND_OTHER);
    }

    public OutgoingEmail withBody(String html, String text) {
        return new OutgoingEmail(to, subject, html, text, headers, kind);
    }

    public OutgoingEmail withKind(String kind) {
        return new OutgoingEmail(to, subject, html, text, headers, kind);
    }
}
