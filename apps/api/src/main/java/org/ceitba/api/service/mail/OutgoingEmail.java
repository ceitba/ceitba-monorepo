package org.ceitba.api.service.mail;

import java.util.Map;

// One email to one recipient: an HTML body with its plain-text alternative,
// plus extra headers (e.g. List-Unsubscribe).
public record OutgoingEmail(String to, String subject, String html, String text, Map<String, String> headers) {

    public OutgoingEmail {
        headers = headers == null ? Map.of() : Map.copyOf(headers);
    }
}
