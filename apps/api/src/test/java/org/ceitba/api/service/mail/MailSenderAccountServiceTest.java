package org.ceitba.api.service.mail;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MailSenderAccountServiceTest {

    private static GoogleMailOAuthClient.IdClaims claims(String email, boolean verified) {
        return new GoogleMailOAuthClient.IdClaims(email, verified, "itba.edu.ar");
    }

    @Test
    void onlyTheExactVerifiedSenderAddressIsAccepted() {
        String sender = "ceitba@itba.edu.ar";
        assertThat(MailSenderAccountService.isSenderAccount(claims("ceitba@itba.edu.ar", true), sender)).isTrue();
        assertThat(MailSenderAccountService.isSenderAccount(claims("CEITBA@ITBA.edu.ar", true), sender)).isTrue();
        assertThat(MailSenderAccountService.isSenderAccount(claims("alice@itba.edu.ar", true), sender)).isFalse();
        assertThat(MailSenderAccountService.isSenderAccount(claims("ceitba@itba.edu.ar.evil.com", true), sender)).isFalse();
        assertThat(MailSenderAccountService.isSenderAccount(claims("xceitba@itba.edu.ar", true), sender)).isFalse();
        assertThat(MailSenderAccountService.isSenderAccount(claims("ceitba@itba.edu.ar", false), sender)).isFalse();
        assertThat(MailSenderAccountService.isSenderAccount(null, sender)).isFalse();
    }

    @Test
    void sendScopeMustHaveBeenGranted() {
        assertThat(MailSenderAccountService.hasSendScope(
            "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send")).isTrue();
        assertThat(MailSenderAccountService.hasSendScope("openid email")).isFalse();
        assertThat(MailSenderAccountService.hasSendScope(null)).isFalse();
    }
}
