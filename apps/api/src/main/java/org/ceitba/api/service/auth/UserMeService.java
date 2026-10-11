package org.ceitba.api.service.auth;

import org.ceitba.api.domain.User;
import org.ceitba.api.service.capability.CapabilityService;
import org.ceitba.api.service.news.FollowService;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.ceitba.api.web.auth.dto.UserMeResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

// Builds the /v1/auth/me payload. Shared by GET /v1/auth/me and the mobile
// token endpoints, which return the same shape under `user`.
// Role is "staff" when the user has an active CeitbaStaff row, otherwise "user".
// `moderator` is true for active staff (STAFF implies MODERATOR) or an active
// ceitba_moderators grant. Called with an API key that lacks the "staff" scope,
// both report a plain user; `apiKeyScopes` lists the key's scopes (null for sessions).
@Service
public class UserMeService {

    private final StaffPowers staffPowers;
    private final OrganizationMembershipService memberships;
    private final FollowService follows;
    private final CapabilityService capabilities;

    public UserMeService(StaffPowers staffPowers,
                         OrganizationMembershipService memberships,
                         FollowService follows,
                         CapabilityService capabilities) {
        this.staffPowers  = staffPowers;
        this.memberships  = memberships;
        this.follows      = follows;
        this.capabilities = capabilities;
    }

    @Transactional(readOnly = true)
    public UserMeResponse describe(User user) {
        // An API key without the staff scope reports the powers it really has (StaffPowers).
        boolean isStaff = staffPowers.isStaff(user.getId());
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
            isStaff || staffPowers.isModerator(user.getId()),
            user.getAvatarUrl(),
            user.getTheme(),
            user.getPreferredLanguage(),
            user.getCareer() != null ? user.getCareer().getId() : null,
            user.getPlan(),
            user.getFileNumber(),
            user.getLinkedin(),
            user.getInstagram(),
            user.getDiscord(),
            orgs,
            followSlugs,
            List.copyOf(capabilities.effective(user)),
            ApiKeyCredential.current().map(k -> ApiKeyScope.keys(k.scopes())).orElse(null)
        );
    }
}
