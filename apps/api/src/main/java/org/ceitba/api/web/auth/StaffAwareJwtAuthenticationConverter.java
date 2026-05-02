package org.ceitba.api.web.auth;

import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

// Maps a verified Google ID token to a JwtAuthenticationToken with the right
// authorities:
//
//   * Allowlist check (auth.allowed-domains + auth.allowed-emails). If the
//     email is not admitted, throw -> Spring translates to 401. The
//     AuthorizationManager-based variant in PR #18 changes this to 403; this
//     class is forward-compatible.
//   * ROLE_USER baseline.
//   * ROLE_STAFF when the User has an active CeitbaStaff row (start <= now <= end).
//
// Lookup happens per request — no caching. If the staff table grows or the
// query gets called >100x/sec, swap in a Caffeine cache keyed by user id.
@Component
public class StaffAwareJwtAuthenticationConverter
        implements Converter<Jwt, AbstractAuthenticationToken> {

    private final AuthProperties authProperties;
    private final UserRepository userRepository;
    private final CeitbaStaffRepository staffRepository;

    public StaffAwareJwtAuthenticationConverter(AuthProperties authProperties,
                                                 UserRepository userRepository,
                                                 CeitbaStaffRepository staffRepository) {
        this.authProperties = authProperties;
        this.userRepository = userRepository;
        this.staffRepository = staffRepository;
    }

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        String email = jwt.getClaimAsString("email");
        if (email == null || !authProperties.admits(email)) {
            throw new AccessDeniedException("Email not authorized: " + email);
        }

        List<GrantedAuthority> authorities = new ArrayList<>();
        authorities.add(new SimpleGrantedAuthority("ROLE_USER"));

        // First request from a brand-new user -> no User row yet -> not staff.
        // CurrentUserResolver will JIT-create the row when a controller asks
        // for @CurrentUser. From the next request onward, STAFF is detectable.
        userRepository.findByEmail(email).ifPresent(user -> {
            if (staffRepository.isActiveStaff(user.getId(), OffsetDateTime.now())) {
                authorities.add(new SimpleGrantedAuthority("ROLE_STAFF"));
            }
        });

        return new JwtAuthenticationToken(jwt, authorities, email);
    }
}
