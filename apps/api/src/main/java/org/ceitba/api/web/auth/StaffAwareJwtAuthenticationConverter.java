package org.ceitba.api.web.auth;

import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

// Maps a verified CEITBA-issued JWT (see JwtIssuerService) to a
// JwtAuthenticationToken with the right authorities:
//
//   * ROLE_USER baseline.
//   * ROLE_STAFF when the User has an active CeitbaStaff row (start <= now <= end).
//
// The email allowlist (auth.allowed-domains + auth.allowed-emails) is enforced
// separately in SecurityConfig via an AuthorizationManager — keeping this
// converter focused on authority extraction.
//
// Lookup happens per request — no caching. If the staff table grows or the
// query gets called >100x/sec, swap in a Caffeine cache keyed by user id.
@Component
public class StaffAwareJwtAuthenticationConverter
        implements Converter<Jwt, AbstractAuthenticationToken> {

    private final UserRepository userRepository;
    private final CeitbaStaffRepository staffRepository;
    private final UserOrganizationRepository membershipRepository;

    public StaffAwareJwtAuthenticationConverter(UserRepository userRepository,
                                                CeitbaStaffRepository staffRepository,
                                                UserOrganizationRepository membershipRepository) {
        this.userRepository = userRepository;
        this.staffRepository = staffRepository;
        this.membershipRepository = membershipRepository;
    }

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        String email = jwt.getClaimAsString("email");

        List<GrantedAuthority> authorities = new ArrayList<>();
        authorities.add(new SimpleGrantedAuthority("ROLE_USER"));

        // First request from a brand-new user -> no User row yet -> not staff.
        // CurrentUserResolver will JIT-create the row when a controller asks
        // for @CurrentUser. From the next request onward, STAFF is detectable.
        if (email != null) {
            userRepository.findByEmail(email).ifPresent(user -> {
                if (staffRepository.isActiveStaff(user.getId(), OffsetDateTime.now())) {
                    authorities.add(new SimpleGrantedAuthority("ROLE_STAFF"));
                }
                if (!membershipRepository.findByUserId(user.getId()).isEmpty()) {
                    authorities.add(new SimpleGrantedAuthority("ROLE_ORG_MEMBER"));
                }
            });
        }

        return new JwtAuthenticationToken(jwt, authorities, email);
    }
}
