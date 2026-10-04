package org.ceitba.api.service.mail;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.config.EmailProperties;
import org.ceitba.api.config.MailOAuthProperties;
import org.ceitba.api.domain.mail.MailSenderAccount;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.mail.MailSenderAccountRepository;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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

    private static final String SENDER = "ceitba@itba.edu.ar";

    private MailSenderAccountService service(MailSenderAccountRepository repo, String key) {
        return new MailSenderAccountService(repo, mock(CeitbaStaffRepository.class), null, null, null,
            new MailOAuthProperties("http://x/cb", key), new EmailProperties(true, null, null, false, null, null,
                null, null, null), mock(DigestProperties.class), Clock.systemUTC());
    }

    @Test
    void anUndecryptableTokenMarksTheAccountBrokenAndReportsItUnavailable() {
        String oldKey = Base64.getEncoder().encodeToString(new byte[32]);
        byte[] other = new byte[32];
        other[0] = 1;
        String newKey = Base64.getEncoder().encodeToString(other);
        String enc = new MailTokenCipher(oldKey).encrypt("refresh-token", SENDER);   // key rotated since
        var row = new MailSenderAccount(SENDER, MailSenderAccount.OWNER_CEITBA, null, enc, "scope", null,
            OffsetDateTime.now());
        var repo = mock(MailSenderAccountRepository.class);
        when(repo.findByEmailIgnoreCase(SENDER)).thenReturn(Optional.of(row));
        var svc = service(repo, newKey);

        assertThat(svc.credentialsFor(SENDER)).isEmpty();
        verify(repo).markBroken(any(), eq(enc), eq(MailSenderAccountService.ERR_UNDECRYPTABLE));
        assertThat(MailSenderAccountService.ERR_UNDECRYPTABLE).isEqualTo("token cannot be decrypted — reconnect");

        // Same check up front (what the digest worker does before claiming anything).
        assertThat(svc.unavailableReason(SENDER)).get().asString().contains("cannot be decrypted");
        // With the right key it is usable.
        assertThat(service(repo, oldKey).credentialsFor(SENDER)).get()
            .extracting(MailSenderAccountService.Credentials::refreshToken).isEqualTo("refresh-token");
        assertThat(service(repo, oldKey).unavailableReason(SENDER)).isEmpty();
    }

    @Test
    void missingOrBrokenAccountsAreUnavailable() {
        var repo = mock(MailSenderAccountRepository.class);
        when(repo.findByEmailIgnoreCase(SENDER)).thenReturn(Optional.empty());
        assertThat(service(repo, "").unavailableReason(SENDER)).get().asString().contains("no connected");
        var row = new MailSenderAccount(SENDER, MailSenderAccount.OWNER_CEITBA, null, "x", "s", null,
            OffsetDateTime.now());
        row.markBroken("revoked");
        when(repo.findByEmailIgnoreCase(SENDER)).thenReturn(Optional.of(row));
        assertThat(service(repo, "").unavailableReason(SENDER)).get().asString().contains("broken");
    }
}
