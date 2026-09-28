package org.ceitba.api.service.auth;

import org.ceitba.api.config.ReviewLoginProperties;
import org.ceitba.api.domain.User;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Locale;
import java.util.regex.Pattern;

// Email + password gate for the single App Store / Play review account
// (POST /v1/auth/review-login). Everyone else signs in with Google.
//
//   * Disabled (404) unless auth.review-login.email and .password-hash are set.
//   * The password is only ever stored as a bcrypt hash.
//   * Constant-time-ish: every attempt runs exactly one bcrypt check, against
//     the real hash when the email matches and against a dummy hash of the
//     same cost otherwise, so response time does not reveal the email. The
//     email itself is compared with MessageDigest.isEqual.
//   * The review account skips the Google-login allowlist here only; after
//     sign-in SessionAllowlist admits it like an allowlisted user. It is a
//     plain USER: nothing here grants STAFF or MODERATOR.
@Service
public class ReviewLoginService {

    private static final Logger log = LoggerFactory.getLogger(ReviewLoginService.class);

    static final String DISPLAY_NAME = "App Review";

    // $2a$/$2b$/$2y$, two-digit cost, 53 chars of salt + hash.
    private static final Pattern BCRYPT = Pattern.compile("^\\$2[aby]?\\$(\\d\\d)\\$[./0-9A-Za-z]{53}$");
    // bcrypt ignores everything past 72 bytes; longer inputs are rejected.
    private static final int MAX_PASSWORD_BYTES = 72;

    private final ReviewLoginProperties props;
    private final UserProvisioningService provisioning;
    private final PasswordEncoder encoder;
    private final String dummyHash;
    private final byte[] expectedEmail;

    @Autowired
    public ReviewLoginService(ReviewLoginProperties props, UserProvisioningService provisioning) {
        this(props, provisioning, new BCryptPasswordEncoder(costOf(props)));
    }

    ReviewLoginService(ReviewLoginProperties props, UserProvisioningService provisioning,
                       PasswordEncoder encoder) {
        this.props        = props;
        this.provisioning = provisioning;
        this.encoder      = encoder;
        if (props.enabled()) {
            if (!BCRYPT.matcher(props.passwordHash()).matches()) {
                throw new IllegalStateException(
                    "auth.review-login.password-hash (REVIEW_LOGIN_PASSWORD_HASH) must be a bcrypt hash ($2a$...)");
            }
            byte[] random = new byte[32];
            new SecureRandom().nextBytes(random);
            this.dummyHash     = encoder.encode(Base64.getEncoder().encodeToString(random));
            this.expectedEmail = sha256(props.email());
            log.warn("Review login is ENABLED for {}. Unset REVIEW_LOGIN_EMAIL / REVIEW_LOGIN_PASSWORD_HASH "
                + "when the app is not under store review.", props.email());
        } else {
            this.dummyHash     = null;
            this.expectedEmail = null;
        }
    }

    // Returns the (JIT-provisioned) review user, or throws
    // ReviewLoginDisabledException (404) / InvalidCredentialsException (401).
    public User authenticate(String email, String password) {
        if (!props.enabled()) {
            throw new ReviewLoginDisabledException();
        }
        boolean emailOk = email != null
            && MessageDigest.isEqual(expectedEmail, sha256(email.trim().toLowerCase(Locale.ROOT)));
        boolean passwordUsable = password != null
            && password.getBytes(StandardCharsets.UTF_8).length <= MAX_PASSWORD_BYTES;

        // Always exactly one bcrypt check, whatever the input.
        boolean passwordOk = encoder.matches(passwordUsable ? password : "",
                                             emailOk ? props.passwordHash() : dummyHash);

        if (!(emailOk && passwordUsable && passwordOk)) {
            log.info("Review login rejected");
            throw new InvalidCredentialsException();
        }
        log.info("Review account signed in");
        return provisioning.findOrCreate(props.email(), DISPLAY_NAME, null, null);
    }

    private static int costOf(ReviewLoginProperties props) {
        if (props.enabled()) {
            var m = BCRYPT.matcher(props.passwordHash());
            if (m.matches()) return Integer.parseInt(m.group(1));
        }
        return 10;
    }

    private static byte[] sha256(String s) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
