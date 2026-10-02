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

    // Followers carry names and emails, so only the org's admins (membership
    // role 'admin') see them; plain members can still edit the profile and
    // publish. STAFF is handled by the hasRole('STAFF') escape hatch.
    public boolean canViewFollowers(String slug, Authentication auth) {
        UUID userId = userIdOf(auth);
        return slug != null && userId != null && membership.userIsAdminOf(userId, slug);
    }

    // For PATCH: the caller must belong to the org that currently owns the
    // article and, when the patch moves it to another org, to that org too.
    // Org-less articles are STAFF-only. A missing article yields false (403).
    public boolean canWriteForArticle(String articleId, String patchOrg, Authentication auth) {
        UUID userId = userIdOf(auth);
        if (userId == null) return false;
        return articleRepo.findById(articleId)
            .map(a -> canMove(userId, a.getOrganization() != null ? a.getOrganization().getSlug() : null, patchOrg))
            .orElse(false);
    }

    public boolean canWriteForEvent(String eventId, String patchOrg, Authentication auth) {
        UUID userId = userIdOf(auth);
        if (userId == null) return false;
        return eventRepo.findById(eventId)
            .map(e -> canMove(userId, e.getOrganization() != null ? e.getOrganization().getSlug() : null, patchOrg))
            .orElse(false);
    }

    private boolean canMove(UUID userId, String currentOrg, String patchOrg) {
        if (currentOrg == null || !membership.userBelongsTo(userId, currentOrg)) return false;
        return patchOrg == null || patchOrg.equals(currentOrg) || membership.userBelongsTo(userId, patchOrg);
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
