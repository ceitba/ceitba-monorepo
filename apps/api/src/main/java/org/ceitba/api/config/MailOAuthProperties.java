package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

// Gmail API sending over OAuth (docs/WEEKLY-DIGEST.md). The OAuth client is
// the login one (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, auth.google.*).
//   redirectUri:        GOOGLE_MAIL_REDIRECT_URI, e.g.
//                       https://ceitba.org.ar/api/v1/mail/accounts/oauth/callback;
//                       must be registered on the Google OAuth client.
//   tokenEncryptionKey: MAIL_TOKEN_ENCRYPTION_KEY, 32 bytes in base64
//                       (openssl rand -base64 32). Required to connect an
//                       account or to send through the Gmail API.
@ConfigurationProperties(prefix = "mail.oauth")
public record MailOAuthProperties(String redirectUri, String tokenEncryptionKey) {

    public MailOAuthProperties {
        redirectUri = redirectUri == null ? "" : redirectUri.trim();
        tokenEncryptionKey = tokenEncryptionKey == null ? "" : tokenEncryptionKey.trim();
    }
}
