package org.ceitba.api.web.news;

import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
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

    // Drafts: members of an organization see its unpublished articles (list
    // with ?organization=<slug>, and GET by id); everyone else only sees
    // published ones. STAFF is handled by the caller.
    public boolean canReadDraftsOf(String orgSlug, Authentication auth) {
        return orgSlug != null && belongsTo(auth, orgSlug);
    }

    // The author (createdBy) of an independent (org-less) article also sees
    // it while unpublished; an org article's drafts are visible to the org's
    // current members only, so an author who left the org loses access.
    public boolean canReadArticleDraft(String articleId, Authentication auth) {
        UUID userId = userIdOf(auth);
        if (userId == null) return false;
        if (articleRepo.findIndependentStatusOwnedBy(articleId, userId).isPresent()) return true;
        return articleRepo.findById(articleId)
            .map(a -> a.getOrganization() != null
                && membership.userBelongsTo(userId, a.getOrganization().getSlug()))
            .orElse(false);
    }

    // Followers carry names and emails, so only the org's admins (membership
    // role 'admin') see them; plain members can still edit the profile and
    // publish. STAFF is handled by the hasRole('STAFF') escape hatch.
    public boolean canViewFollowers(String slug, Authentication auth) {
        UUID userId = userIdOf(auth);
        return slug != null && userId != null && membership.userIsAdminOf(userId, slug);
    }

    // Member management (OrgMembersController) is for the org's admins: it
    // exposes members' emails and decides who can publish for the org.
    public boolean canManageMembers(String slug, Authentication auth) {
        return canViewFollowers(slug, auth);
    }

    // DELETE of an org's article or event by any current member of that org
    // (members already publish and edit for it). Org-less articles fail this
    // check; their author is covered by canDeleteOwnIndependentArticle. A
    // missing item yields false (403).
    public boolean canDeleteArticle(String articleId, Authentication auth) {
        UUID userId = userIdOf(auth);
        if (userId == null) return false;
        return articleRepo.findById(articleId)
            .map(a -> a.getOrganization() != null
                && membership.userBelongsTo(userId, a.getOrganization().getSlug()))
            .orElse(false);
    }

    public boolean canDeleteEvent(String eventId, Authentication auth) {
        UUID userId = userIdOf(auth);
        if (userId == null) return false;
        return eventRepo.findById(eventId)
            .map(e -> e.getOrganization() != null
                && membership.userBelongsTo(userId, e.getOrganization().getSlug()))
            .orElse(false);
    }

    // An event's RSVP list (names, emails): the admins of its organization,
    // and its plain members unless the admins turned that off.
    public boolean canSeeAttendees(String eventId, Authentication auth) {
        UUID userId = userIdOf(auth);
        if (userId == null) return false;
        return eventRepo.findById(eventId)
            .map(e -> e.getOrganization() != null
                && membership.userSeesAttendeesOf(userId, e.getOrganization().getSlug()))
            .orElse(false);
    }

    // For PATCH: the caller must belong to the org that currently owns the
    // article and, when the patch moves it to another org, to that org too.
    // Org-less articles fail this check; their author is covered by
    // canEditOwnIndependentArticle. A missing article yields false (403).
    public boolean canWriteForArticle(String articleId, String patchOrg, Authentication auth) {
        UUID userId = userIdOf(auth);
        if (userId == null) return false;
        return articleRepo.findById(articleId)
            .map(a -> canMove(userId, a.getOrganization() != null ? a.getOrganization().getSlug() : null, patchOrg))
            .orElse(false);
    }

    // Independent (org-less) articles: any signed-in user may create one;
    // STAFF moderates (publishes) it. See ArticleController for the status
    // limits applied to non-staff authors.
    public boolean isIndependent(String orgSlug) {
        return orgSlug == null || orgSlug.isBlank();
    }

    // PATCH by the author of an independent article: allowed while it isn't
    // published, and only if the patch keeps it org-less or moves it into an
    // org the author belongs to (never someone else's org).
    public boolean canEditOwnIndependentArticle(String articleId, String patchOrg, Authentication auth) {
        UUID userId = userIdOf(auth);
        if (userId == null) return false;
        boolean editable = articleRepo.findIndependentStatusOwnedBy(articleId, userId)
            .map(status -> !"published".equals(status))
            .orElse(false);
        return editable && (isIndependent(patchOrg) || membership.userBelongsTo(userId, patchOrg));
    }

    // DELETE by the author of an independent, not-yet-published article.
    public boolean canDeleteOwnIndependentArticle(String articleId, Authentication auth) {
        return canEditOwnIndependentArticle(articleId, null, auth);
    }

    // Current user's id (API key -> its User; JWT email -> users row), or
    // null for anonymous callers and not-yet-provisioned users.
    public UUID currentUserId(Authentication auth) {
        return userIdOf(auth);
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
        // Anonymous callers carry the principal name "anonymousUser"; never
        // look that up as an email.
        if (auth == null || auth instanceof AnonymousAuthenticationToken || !auth.isAuthenticated()) {
            return null;
        }
        // ApiKeyFilter authenticates ceitba_ keys with the User entity itself
        // as principal (its getName() is User.toString(), not an email).
        if (auth.getPrincipal() instanceof User user) return user.getId();
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
