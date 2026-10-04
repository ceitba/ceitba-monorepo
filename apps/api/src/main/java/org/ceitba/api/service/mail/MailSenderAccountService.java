package org.ceitba.api.service.mail;

import org.ceitba.api.common.exception.FeatureNotConfiguredException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.config.EmailProperties;
import org.ceitba.api.config.MailOAuthProperties;
import org.ceitba.api.domain.mail.MailSenderAccount;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.mail.MailSenderAccountRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

// Connected sender accounts (table mail_sender_account): the CEITBA account
// now, per-organization ones later (owner_type 'organization').
//
// Connect flow (staff): connect() -> Google consent -> handleCallback(), which
// exchanges the code, requires the id_token email to be EXACTLY the configured
// sender (MAIL_FROM) and stores the refresh token encrypted.
@Service
public class MailSenderAccountService {

    private static final Logger log = LoggerFactory.getLogger(MailSenderAccountService.class);

    public static final String STATUS_CONNECTED = "connected";
    public static final String STATUS_BROKEN = "broken";
    public static final String STATUS_MISSING = "missing";

    // Reasons of ?mail=error&reason=... on the post-callback redirect.
    public static final String ERR_ACCESS_DENIED = "access_denied";
    public static final String ERR_INVALID_STATE = "invalid_state";
    public static final String ERR_NOT_STAFF = "not_staff";
    public static final String ERR_WRONG_ACCOUNT = "wrong_account";
    public static final String ERR_MISSING_SCOPE = "missing_scope";
    public static final String ERR_NO_REFRESH_TOKEN = "no_refresh_token";
    public static final String ERR_EXCHANGE_FAILED = "exchange_failed";

    public record AccountView(Long id, String email, String ownerType, String ownerRef, String status,
                              OffsetDateTime connectedAt, String lastError, OffsetDateTime lastUsedAt) {}

    // A usable account with its decrypted refresh token (never serialized).
    public record Credentials(Long accountId, String email, String refreshToken, String tokenEnc) {}

    private final MailSenderAccountRepository accounts;
    private final CeitbaStaffRepository staff;
    private final GoogleMailOAuthClient google;
    private final MailOAuthStateService states;
    private final MailLedger ledger;
    private final MailOAuthProperties oauth;
    private final EmailProperties email;
    private final DigestProperties digest;
    private final Clock clock;

    public MailSenderAccountService(MailSenderAccountRepository accounts, CeitbaStaffRepository staff,
                                    GoogleMailOAuthClient google, MailOAuthStateService states, MailLedger ledger,
                                    MailOAuthProperties oauth, EmailProperties email, DigestProperties digest,
                                    Clock clock) {
        this.accounts = accounts;
        this.staff = staff;
        this.google = google;
        this.states = states;
        this.ledger = ledger;
        this.oauth = oauth;
        this.email = email;
        this.digest = digest;
        this.clock = clock;
    }

    public URI connect(UUID staffUserId) {
        if (!google.configured()) {
            throw new FeatureNotConfiguredException("Gmail sender connection needs GOOGLE_CLIENT_ID, "
                + "GOOGLE_CLIENT_SECRET and GOOGLE_MAIL_REDIRECT_URI");
        }
        cipher();  // fails fast without MAIL_TOKEN_ENCRYPTION_KEY
        String sender = email.account();
        return google.authorizationUri(states.issue(staffUserId), sender, domainOf(sender));
    }

    // Always returns where to send the browser; never throws.
    public URI handleCallback(String code, String state, String error) {
        var staffUser = states.verify(state);
        if (staffUser.isEmpty()) return redirect(ERR_INVALID_STATE);
        if (!staff.isActiveStaff(staffUser.get(), OffsetDateTime.now(clock))) return redirect(ERR_NOT_STAFF);
        if (error != null) {
            return redirect("access_denied".equals(error) ? ERR_ACCESS_DENIED : ERR_EXCHANGE_FAILED);
        }
        if (code == null || code.isBlank()) return redirect(ERR_EXCHANGE_FAILED);
        try {
            var tokens = google.exchangeCode(code);
            var claims = google.parseIdToken(tokens.idToken());
            String expected = email.account();
            if (!isSenderAccount(claims, expected)) return redirect(ERR_WRONG_ACCOUNT);
            if (!hasSendScope(tokens.scope())) return redirect(ERR_MISSING_SCOPE);
            if (tokens.refreshToken() == null || tokens.refreshToken().isBlank()) {
                return redirect(ERR_NO_REFRESH_TOKEN);
            }
            store(expected, tokens.refreshToken(), tokens.scope(), staffUser.get());
            log.info("Mail: sender account {} connected by staff user {}", expected, staffUser.get());
            return redirect(null);
        } catch (RuntimeException e) {
            // Class only: never tokens or Google's payload.
            log.warn("Mail: connecting the sender account failed: {}", e.getClass().getSimpleName());
            return redirect(ERR_EXCHANGE_FAILED);
        }
    }

    // The address that connected must be exactly the configured sender, verified.
    static boolean isSenderAccount(GoogleMailOAuthClient.IdClaims claims, String expectedEmail) {
        return claims != null && claims.emailVerified() && claims.email() != null
            && claims.email().trim().toLowerCase(Locale.ROOT).equals(expectedEmail.trim().toLowerCase(Locale.ROOT));
    }

    static boolean hasSendScope(String scope) {
        return scope != null && Arrays.asList(scope.split("\\s+")).contains(GoogleMailOAuthClient.SCOPE_SEND);
    }

    private void store(String senderEmail, String refreshToken, String scopes, UUID by) {
        var now = OffsetDateTime.now(clock);
        String enc = cipher().encrypt(refreshToken, senderEmail);
        var row = accounts.findFirstByOwnerTypeAndOwnerRefIsNull(MailSenderAccount.OWNER_CEITBA).orElse(null);
        if (row == null || !row.getEmail().equalsIgnoreCase(senderEmail)) {
            if (row != null) accounts.delete(row);
            accounts.flush();
            accounts.save(new MailSenderAccount(senderEmail, MailSenderAccount.OWNER_CEITBA, null, enc, scopes, by, now));
        } else {
            row.connect(enc, scopes, by, now);
            accounts.save(row);
        }
        // A broken-sender backoff must not outlive the reconnection.
        ledger.saveState(senderEmail, MailLedger.State.CLEAR, clock.instant());
    }

    public List<AccountView> list() {
        return accounts.findAllByOrderByIdAsc().stream().map(MailSenderAccountService::view).toList();
    }

    // Revokes the token at Google (best effort), then deletes the row.
    public void delete(Long id) {
        var row = accounts.findById(id).orElseThrow(() -> new ResourceNotFoundException("MailSenderAccount", id.toString()));
        try {
            google.revoke(cipher().decrypt(row.getRefreshTokenEnc(), row.getEmail()));
        } catch (RuntimeException e) {
            log.warn("Mail: could not revoke the token of {} at Google (deleting anyway): {}", row.getEmail(),
                e.getClass().getSimpleName());
        }
        accounts.delete(row);
    }

    // connected | broken | missing, for the configured sender (CEITBA account).
    public String senderStatus() {
        return accounts.findByEmailIgnoreCase(email.account())
            .map(a -> MailSenderAccount.CONNECTED.equals(a.getStatus()) ? STATUS_CONNECTED
                : MailSenderAccount.BROKEN.equals(a.getStatus()) ? STATUS_BROKEN : STATUS_MISSING)
            .orElse(STATUS_MISSING);
    }

    public static final String ERR_UNDECRYPTABLE = "token cannot be decrypted — reconnect";

    // The connected account for `senderEmail`, decrypted; empty when missing,
    // broken or revoked. A stored token that cannot be decrypted (the key was
    // lost or rotated, or the tag does not match) marks the account broken:
    // the status then reports `broken` and the UI offers a reconnect.
    public Optional<Credentials> credentialsFor(String senderEmail) {
        var row = accounts.findByEmailIgnoreCase(senderEmail)
            .filter(a -> MailSenderAccount.CONNECTED.equals(a.getStatus()));
        if (row.isEmpty()) return Optional.empty();
        var a = row.get();
        String token;
        try {
            token = cipher().decrypt(a.getRefreshTokenEnc(), a.getEmail());
        } catch (MailTokenCipher.TokenDecryptionException e) {
            accounts.markBroken(a.getId(), a.getRefreshTokenEnc(), ERR_UNDECRYPTABLE);
            log.warn("Mail: sender account {} is broken, reconnect it ({})", a.getEmail(), ERR_UNDECRYPTABLE);
            return Optional.empty();
        }
        return Optional.of(new Credentials(a.getId(), a.getEmail(), token, a.getRefreshTokenEnc()));
    }

    // Why `senderEmail` cannot send right now (missing, broken, undecryptable
    // token, no encryption key), or empty when it is usable. Decrypts, so an
    // undecryptable token is detected (and marked broken) before any delivery
    // is claimed.
    public Optional<String> unavailableReason(String senderEmail) {
        var row = accounts.findByEmailIgnoreCase(senderEmail);
        if (row.isEmpty()) return Optional.of("no connected Gmail sender account for " + senderEmail);
        var a = row.get();
        if (!MailSenderAccount.CONNECTED.equals(a.getStatus())) {
            return Optional.of("Gmail sender account " + senderEmail + " is broken"
                + (a.getLastError() == null ? "" : " (" + a.getLastError() + ")") + ": reconnect it");
        }
        try {
            if (credentialsFor(senderEmail).isEmpty()) {
                return Optional.of("Gmail sender account " + senderEmail + " is broken (" + ERR_UNDECRYPTABLE + ")");
            }
        } catch (FeatureNotConfiguredException e) {
            return Optional.of(e.getMessage());
        }
        return Optional.empty();
    }

    // Google rejected this token: reconnect needed. No-op if it was replaced meanwhile.
    public void markBroken(Credentials c, String error) {
        accounts.markBroken(c.accountId(), c.tokenEnc(), truncate(error));
        log.warn("Mail: sender account {} is broken, reconnect it ({})", c.email(), error);
    }

    public void markUsed(Credentials c) {
        accounts.markUsed(c.accountId(), OffsetDateTime.now(clock));
    }

    private MailTokenCipher cipher() {
        if (oauth.tokenEncryptionKey().isBlank()) {
            throw new FeatureNotConfiguredException("MAIL_TOKEN_ENCRYPTION_KEY is not set "
                + "(openssl rand -base64 32)");
        }
        return new MailTokenCipher(oauth.tokenEncryptionKey());
    }

    private URI redirect(String errorReason) {
        var b = UriComponentsBuilder.fromUriString(digest.publicBaseUrl() + "/admin/digests");
        if (errorReason == null) b.queryParam("mail", "connected");
        else b.queryParam("mail", "error").queryParam("reason", errorReason);
        return b.build().toUri();
    }

    private static AccountView view(MailSenderAccount a) {
        return new AccountView(a.getId(), a.getEmail(), a.getOwnerType(), a.getOwnerRef(), a.getStatus(),
            a.getConnectedAt(), a.getLastError(), a.getLastUsedAt());
    }

    private static String domainOf(String address) {
        int at = address.lastIndexOf('@');
        return at < 0 ? null : address.substring(at + 1);
    }

    private static String truncate(String s) {
        return s == null ? null : (s.length() > 500 ? s.substring(0, 500) : s);
    }
}
