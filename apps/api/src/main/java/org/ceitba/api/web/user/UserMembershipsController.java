package org.ceitba.api.web.user;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// Staff-only endpoints for the management UI: assign, re-role or revoke a
// user's organization membership. The user-facing /v1/me/organizations stays as-is
// (read-only self view).
@Tag(name = "Users")
@RestController
@RequestMapping("/v1/users/{userId}/organizations")
@PreAuthorize("hasRole('STAFF')")
public class UserMembershipsController {

    private final OrganizationMembershipService memberships;

    public UserMembershipsController(OrganizationMembershipService memberships) {
        this.memberships = memberships;
    }

    @GetMapping
    @Operation(summary = "List a user's organization memberships (STAFF only)")
    public List<MembershipResponse> list(@PathVariable UUID userId) {
        return memberships.listForUser(userId).stream()
            .map(m -> new MembershipResponse(m.getOrganization(), m.getRole()))
            .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Add a user to an organization (STAFF only)")
    public MembershipResponse add(@PathVariable UUID userId,
                                   @Valid @RequestBody AddMembershipRequest req) {
        var saved = memberships.add(userId, req.slug(), req.role());
        return new MembershipResponse(saved.getOrganization(), saved.getRole());
    }

    @PatchMapping("/{slug}")
    @Operation(summary = "Change a user's role in an organization (STAFF only)")
    public MembershipResponse updateRole(@PathVariable UUID userId,
                                          @PathVariable String slug,
                                          @Valid @RequestBody UpdateMembershipRequest req) {
        var saved = memberships.updateRole(userId, slug, req.role());
        return new MembershipResponse(saved.getOrganization(), saved.getRole());
    }

    @DeleteMapping("/{slug}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Remove a user from an organization (STAFF only)")
    public void remove(@PathVariable UUID userId, @PathVariable String slug) {
        memberships.remove(userId, slug);
    }

    public record AddMembershipRequest(@NotBlank String slug, String role) {}
    public record UpdateMembershipRequest(@NotBlank String role) {}
    public record MembershipResponse(String slug, String role) {}
}
