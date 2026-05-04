package org.ceitba.api.web.news;

import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

import java.util.UUID;

// SpEL helper exposed as @orgAccess in @PreAuthorize. Lets non-staff org
// members write articles/events for their own organization and edit their
// org's profile, while keeping the existing hasRole('STAFF') escape hatch
// for the CEITBA superadmin.
@Component("orgAccess")
public class OrgAccess {

    private final UserRepository userRepo;
    private final OrganizationMembershipService membership;
    private final ArticleRepository articleRepo;
    private final NewsEventRepository eventRepo;

    public OrgAccess(UserRepository userRepo,
                     OrganizationMembershipService membership,
                     ArticleRepository articleRepo,
                     NewsEventRepository eventRepo) {
        this.userRepo   = userRepo;
        this.membership = membership;
        this.articleRepo = articleRepo;
        this.eventRepo  = eventRepo;
    }

    public boolean canEditOrg(String slug, Authentication auth) {
        return slug != null && belongsTo(auth, slug);
    }

    public boolean canWriteForOrg(String orgSlug, Authentication auth) {
        return orgSlug != null && belongsTo(auth, orgSlug);
    }

    // For PATCH: when the patch body omits `organization`, fall back to the
    // existing article's org so we never green-light a write the caller
    // wouldn't otherwise be allowed to make.
    public boolean canWriteForArticle(String articleId, String patchOrg, Authentication auth) {
        UUID userId = userIdOf(auth);
        if (userId == null) return false;
        if (patchOrg != null) return membership.userBelongsTo(userId, patchOrg);
        return articleRepo.findById(articleId)
            .map(a -> a.getOrganization() != null
                && membership.userBelongsTo(userId, a.getOrganization().getSlug()))
            .orElse(false);
    }

    public boolean canWriteForEvent(String eventId, String patchOrg, Authentication auth) {
        UUID userId = userIdOf(auth);
        if (userId == null) return false;
        if (patchOrg != null) return membership.userBelongsTo(userId, patchOrg);
        return eventRepo.findById(eventId)
            .map(e -> e.getOrganization() != null
                && membership.userBelongsTo(userId, e.getOrganization().getSlug()))
            .orElse(false);
    }

    private boolean belongsTo(Authentication auth, String orgSlug) {
        UUID userId = userIdOf(auth);
        return userId != null && membership.userBelongsTo(userId, orgSlug);
    }

    private UUID userIdOf(Authentication auth) {
        String email = emailOf(auth);
        if (email == null) return null;
        return userRepo.findByEmail(email).map(u -> u.getId()).orElse(null);
    }

    private String emailOf(Authentication auth) {
        if (auth instanceof JwtAuthenticationToken jwtAuth) {
            Jwt jwt = jwtAuth.getToken();
            return jwt.getClaimAsString("email");
        }
        return auth != null ? auth.getName() : null;
    }
}
