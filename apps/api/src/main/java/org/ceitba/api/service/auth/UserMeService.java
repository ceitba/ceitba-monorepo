package org.ceitba.api.service.auth;

import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.service.news.FollowService;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.ceitba.api.web.auth.dto.UserMeResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;

// Builds the /v1/auth/me payload. Shared by GET /v1/auth/me and the mobile
// token endpoints, which return the same shape under `user`.
// Role is "staff" when the user has an active CeitbaStaff row, otherwise "user".
@Service
public class UserMeService {

    private final CeitbaStaffRepository staffRepository;
    private final OrganizationMembershipService memberships;
    private final FollowService follows;
    private final Clock clock;

    public UserMeService(CeitbaStaffRepository staffRepository,
                         OrganizationMembershipService memberships,
                         FollowService follows,
                         Clock clock) {
        this.staffRepository = staffRepository;
        this.memberships     = memberships;
        this.follows         = follows;
        this.clock           = clock;
    }

    @Transactional(readOnly = true)
    public UserMeResponse describe(User user) {
        boolean isStaff = staffRepository.isActiveStaff(user.getId(), OffsetDateTime.now(clock));
        var orgs = memberships.listForUser(user.getId()).stream()
            .map(m -> new UserMeResponse.MembershipDto(m.getOrganization(), m.getRole()))
            .toList();
        var followSlugs = follows.listForUser(user.getId()).stream()
            .map(f -> f.getOrganization())
            .toList();
        return new UserMeResponse(
            user.getId(),
            user.getName(),
            user.getEmail(),
            isStaff ? "staff" : "user",
            user.getAvatarUrl(),
            user.getTheme(),
            user.getPreferredLanguage(),
            user.getCareer() != null ? user.getCareer().getId() : null,
            user.getPlan(),
            user.getFileNumber(),
            orgs,
            followSlugs
        );
    }
}
