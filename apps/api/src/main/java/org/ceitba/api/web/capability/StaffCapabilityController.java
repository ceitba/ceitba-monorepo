package org.ceitba.api.web.capability;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.capability.CapabilityAdminService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.capability.dto.CapabilityGrantsResponse;
import org.ceitba.api.web.capability.dto.CapabilityResponse;
import org.ceitba.api.web.capability.dto.GrantUsersRequest;
import org.ceitba.api.web.capability.dto.UpdateCapabilityRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// Capability management (docs/CAPABILITIES.md). STAFF only: /v1/staff/** is
// path-protected in SecurityConfig and @PreAuthorize repeats it.
@Tag(name = "Staff")
@RestController
@RequestMapping("/v1/staff/capabilities")
@SecurityRequirement(name = "bearerAuth")
@PreAuthorize("hasRole('STAFF')")
public class StaffCapabilityController {

    private final CapabilityAdminService service;

    public StaffCapabilityController(CapabilityAdminService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Every capability in the registry with its global switch and grant counts")
    public List<CapabilityResponse> list() {
        return service.list();
    }

    @PutMapping("/{key}")
    @Operation(summary = "Enable or disable a capability for every user (404 unknown key)")
    public CapabilityResponse update(@CurrentUser User staff, @PathVariable String key,
                                     @Valid @RequestBody UpdateCapabilityRequest req) {
        return service.setEnabledForAll(key, req.enabledForAll(), idOf(staff));
    }

    @GetMapping("/{key}/grants")
    @Operation(summary = "Email and organization grants of a capability")
    public CapabilityGrantsResponse grants(@PathVariable String key) {
        return service.grants(key);
    }

    @PostMapping("/{key}/users")
    @Operation(summary = "Grant a capability to emails (trimmed, lowercased, deduped; 400 on a malformed email); "
        + "returns the updated grants")
    public CapabilityGrantsResponse grantUsers(@CurrentUser User staff, @PathVariable String key,
                                               @Valid @RequestBody GrantUsersRequest req) {
        return service.grantUsers(key, req.emails(), idOf(staff));
    }

    @DeleteMapping("/{key}/users/{email}")
    @Operation(summary = "Revoke an email grant (no-op when missing); returns the updated grants")
    public CapabilityGrantsResponse revokeUser(@PathVariable String key, @PathVariable String email) {
        return service.revokeUser(key, email);
    }

    @PutMapping("/{key}/orgs/{slug}")
    @Operation(summary = "Grant a capability to every member of an organization (404 unknown org); "
        + "returns the updated grants")
    public CapabilityGrantsResponse grantOrg(@CurrentUser User staff, @PathVariable String key,
                                             @PathVariable String slug) {
        return service.grantOrg(key, slug, idOf(staff));
    }

    @DeleteMapping("/{key}/orgs/{slug}")
    @Operation(summary = "Revoke an organization grant (no-op when missing); returns the updated grants")
    public CapabilityGrantsResponse revokeOrg(@PathVariable String key, @PathVariable String slug) {
        return service.revokeOrg(key, slug);
    }

    private static UUID idOf(User staff) {
        return staff != null ? staff.getId() : null;
    }
}
