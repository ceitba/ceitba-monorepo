package org.ceitba.api.web.staff;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.staff.ModeratorService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.staff.dto.GrantModeratorRequest;
import org.ceitba.api.web.staff.dto.ModeratorResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// MODERATOR grants. STAFF only: /v1/staff/** is path-protected in
// SecurityConfig and @PreAuthorize repeats it. MODERATOR itself cannot grant.
@Tag(name = "Staff")
@RestController
@RequestMapping("/v1/staff/moderators")
@SecurityRequirement(name = "bearerAuth")
@PreAuthorize("hasRole('STAFF')")
public class ModeratorController {

    private final ModeratorService moderators;

    public ModeratorController(ModeratorService moderators) {
        this.moderators = moderators;
    }

    @GetMapping
    @Operation(summary = "List active MODERATOR grants (active STAFF are moderators implicitly and are not listed)")
    public List<ModeratorResponse> list() {
        return moderators.listActive();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Grant MODERATOR to a user by email (404 unknown user, 409 already a moderator)")
    public ModeratorResponse grant(@CurrentUser User staff, @Valid @RequestBody GrantModeratorRequest req) {
        return moderators.grant(req.email(), staff != null ? staff.getId() : null);
    }

    @DeleteMapping("/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Revoke a MODERATOR grant (kept for audit; 404 when there is no active grant)")
    public void revoke(@CurrentUser User staff, @PathVariable UUID userId) {
        moderators.revoke(userId, staff != null ? staff.getId() : null);
    }
}
