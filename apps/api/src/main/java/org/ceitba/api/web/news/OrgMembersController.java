package org.ceitba.api.web.news;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.ceitba.api.service.news.OrganizationMembershipService.InviteResult;
import org.ceitba.api.service.news.OrganizationMembershipService.InviteView;
import org.ceitba.api.service.news.OrganizationMembershipService.MemberView;
import org.ceitba.api.web.auth.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// Self-service membership for an organization's admins (docs/ORGANIZATIONS.md):
// list members and pending invites, invite by email, change roles and board
// titles, remove members and hand the admin role over. STAFF can do the same
// for any org. Any member may leave (DELETE /me). Removing or demoting the
// last admin is 409 LastOrgAdmin, except for STAFF.
@Tag(name = "Organizations")
@RestController
@RequestMapping("/v1/organizations/{slug}/members")
public class OrgMembersController {

    private static final String MANAGE =
        "hasRole('STAFF') or @orgAccess.canManageMembers(#slug, authentication)";

    private final OrganizationMembershipService memberships;

    public OrgMembersController(OrganizationMembershipService memberships) {
        this.memberships = memberships;
    }

    @GetMapping
    @PreAuthorize(MANAGE)
    @Operation(summary = "List the organization's members and pending invites (org admin or STAFF)")
    public MembersResponse list(@PathVariable String slug) {
        return new MembersResponse(memberships.members(slug), memberships.invites(slug));
    }

    @PostMapping("/invites")
    @PreAuthorize(MANAGE)
    @Operation(summary = "Invite emails: existing users join now, others on their first login")
    public InviteResult invite(@PathVariable String slug, @CurrentUser User user,
                               @Valid @RequestBody InviteRequest req) {
        return memberships.invite(slug, req.emails(), req.role(), user.getId());
    }

    @DeleteMapping("/invites")
    @PreAuthorize(MANAGE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Revoke a pending invite")
    public void revokeInvite(@PathVariable String slug, @RequestParam String email) {
        memberships.revokeInvite(slug, email);
    }

    @PatchMapping("/{userId}")
    @PreAuthorize(MANAGE)
    @Operation(summary = "Change a member's role, board title or portal visibility")
    public MemberView update(@PathVariable String slug, @PathVariable UUID userId,
                             @Valid @RequestBody UpdateMemberRequest req, Authentication auth) {
        memberships.update(userId, slug, req.role(), req.title(), req.showOnPortal(), !isStaff(auth));
        return memberships.memberView(userId, slug);
    }

    @DeleteMapping("/{userId}")
    @PreAuthorize(MANAGE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Remove a member")
    public void remove(@PathVariable String slug, @PathVariable UUID userId, Authentication auth) {
        memberships.remove(userId, slug, !isStaff(auth));
    }

    @PostMapping("/{userId}/transfer-admin")
    @PreAuthorize("@orgAccess.canManageMembers(#slug, authentication)")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Make a member admin and step down to member (calling org admin)")
    public void transferAdmin(@PathVariable String slug, @PathVariable UUID userId, @CurrentUser User user) {
        memberships.transferAdmin(slug, user.getId(), userId);
    }

    @DeleteMapping("/me")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Leave the organization")
    public void leave(@PathVariable String slug, @CurrentUser User user) {
        memberships.remove(user.getId(), slug, true);
    }

    private static boolean isStaff(Authentication auth) {
        return auth.getAuthorities().stream().anyMatch(a -> "ROLE_STAFF".equals(a.getAuthority()));
    }

    public record MembersResponse(List<MemberView> members, List<InviteView> invites) {}

    public record InviteRequest(@NotEmpty @Size(max = 50) List<String> emails, String role) {}

    // null = leave unchanged; a blank title clears it.
    public record UpdateMemberRequest(String role, @Size(max = 60) String title, Boolean showOnPortal) {}
}
