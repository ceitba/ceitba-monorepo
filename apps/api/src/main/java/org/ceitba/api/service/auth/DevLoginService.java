package org.ceitba.api.service.auth;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.CeitbaBranch;
import org.ceitba.api.domain.CeitbaStaff;
import org.ceitba.api.domain.CeitbaStaffRole;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Locale;

// LOCAL DEVELOPMENT ONLY: signs in as any allowlisted email without Google
// (POST /v1/auth/dev-login). The bean exists only with the `dev` profile AND
// auth.dev-login.enabled=true (AUTH_DEV_LOGIN_ENABLED); otherwise the
// endpoint does not exist. staff=true ensures an active ceitba_staff row.
@Service
@Profile("dev")
@ConditionalOnProperty(name = "auth.dev-login.enabled", havingValue = "true")
public class DevLoginService {

    private static final Logger log = LoggerFactory.getLogger(DevLoginService.class);

    private static final OffsetDateTime FOREVER = OffsetDateTime.of(9999, 12, 31, 23, 59, 59, 0, ZoneOffset.UTC);

    private final UserProvisioningService provisioning;
    private final UserRepository users;
    private final CeitbaStaffRepository staff;
    private final SessionAllowlist allowlist;
    private final JwtIssuerService jwtIssuer;
    private final Clock clock;

    public DevLoginService(UserProvisioningService provisioning, UserRepository users, CeitbaStaffRepository staff,
                           SessionAllowlist allowlist, JwtIssuerService jwtIssuer, Clock clock) {
        this.provisioning = provisioning;
        this.users = users;
        this.staff = staff;
        this.allowlist = allowlist;
        this.jwtIssuer = jwtIssuer;
        this.clock = clock;
        log.warn("DEV LOGIN ENABLED: POST /v1/auth/dev-login signs in as any allowlisted email. Never in prod.");
    }

    // Returns the session JWT for the (JIT-provisioned) user.
    @Transactional
    public String login(String email, String name, boolean asStaff) {
        var normalized = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        if (!normalized.contains("@")) throw new ValidationException("email", email, "must be an email address");
        if (!allowlist.admits(normalized)) {
            throw new ValidationException("email", email, "not in AUTH_ALLOWED_DOMAINS / AUTH_ALLOWED_EMAILS");
        }
        var provisioned = provisioning.findOrCreate(normalized,
            name == null || name.isBlank() ? normalized : name.trim(), null, null);
        var now = OffsetDateTime.now(clock);
        if (asStaff && !staff.isActiveStaff(provisioned.getId(), now)) {
            staff.findById(provisioned.getId()).ifPresent(staff::delete);
            staff.flush();
            var user = users.getReferenceById(provisioned.getId());
            staff.save(new CeitbaStaff(user, CeitbaBranch.IT, CeitbaStaffRole.MEMBER, now.minusMinutes(1), FOREVER));
        }
        log.info("Dev login as {} (staff={})", normalized, asStaff);
        return jwtIssuer.issue(provisioned);
    }
}
