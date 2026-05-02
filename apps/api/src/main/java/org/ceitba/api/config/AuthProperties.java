package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

// Bound from auth.* in application.yml. Override at runtime via env:
//   AUTH_ALLOWED_DOMAINS=itba.edu.ar,alu.itba.edu.ar
//   AUTH_ALLOWED_EMAILS=admin@gmail.com,founder@gmail.com
//   AUTH_SYNC_API_KEY=...
@ConfigurationProperties(prefix = "auth")
public record AuthProperties(
    List<String> allowedDomains,
    List<String> allowedEmails,
    String syncApiKey
) {
    public AuthProperties {
        allowedDomains = allowedDomains != null ? allowedDomains : List.of();
        allowedEmails = allowedEmails != null ? allowedEmails : List.of();
    }

    public boolean admits(String email) {
        if (email == null) return false;
        var lower = email.toLowerCase();
        for (var d : allowedDomains) {
            if (lower.endsWith("@" + d.toLowerCase())) return true;
        }
        for (var e : allowedEmails) {
            if (lower.equals(e.toLowerCase())) return true;
        }
        return false;
    }
}
