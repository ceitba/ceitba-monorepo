package org.ceitba.api.web.user;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.user.UserProfileService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.user.dto.MePreferencesResponse;
import org.ceitba.api.web.user.dto.MeProfileResponse;
import org.ceitba.api.web.user.dto.UpdatePreferencesRequest;
import org.ceitba.api.web.user.dto.UpdateProfileRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Self-service endpoints under /v1/me. Authentication is required (allowlist
// gate inherited from anyRequest().access(authenticatedAndAllowlisted)).
//
// Two halves:
//   /preferences  — theme + language. Synced across all CEITBA SPAs on the
//                   ceitba.org.ar origin so signing in once propagates the
//                   look and language everywhere.
//   /profile      — career + plan + social handles, editable here, plus the
//                   file number (legajo), which the user enters once; after
//                   that only staff change it (/v1/users/{id}/file-number).
@Tag(name = "Me")
@RestController
@RequestMapping("/v1/me")
public class MeProfileController {

    private final UserProfileService profiles;

    public MeProfileController(UserProfileService profiles) {
        this.profiles = profiles;
    }

    @GetMapping("/preferences")
    @Operation(summary = "Get current user's theme and language")
    public MePreferencesResponse getPreferences(@CurrentUser User user) {
        return profiles.getPreferences(user.getId());
    }

    @PatchMapping("/preferences")
    @Operation(summary = "Update theme and/or language. Null fields are left alone; empty string clears.")
    public MePreferencesResponse patchPreferences(@CurrentUser User user,
                                                   @Valid @RequestBody UpdatePreferencesRequest req) {
        return profiles.updatePreferences(user.getId(), req);
    }

    @GetMapping("/profile")
    @Operation(summary = "Get current user's career, plan, file number and social handles")
    public MeProfileResponse getProfile(@CurrentUser User user) {
        return profiles.getProfile(user.getId());
    }

    @PatchMapping("/profile")
    @Operation(summary = "Update career, plan, social handles and/or set the file number once",
        description = "Null fields are left alone; empty string clears. `plan` must be a plan id of the "
            + "resulting career (400 otherwise); changing `careerId` without `plan` clears the plan. "
            + "Social fields accept a handle, @handle or profile URL and are stored as the bare handle. "
            + "`fileNumber` (the ITBA legajo, 5-6 digits, 400 otherwise) can only be set while it is "
            + "empty: 409 `FileNumberAlreadySet` if a different one is already stored (sending the same "
            + "one is a no-op), 409 `FileNumberTaken` if another account has it. It cannot be cleared "
            + "here; staff change it via PATCH /v1/users/{id}/file-number. On a 409 nothing is saved.")
    public MeProfileResponse patchProfile(@CurrentUser User user,
                                           @Valid @RequestBody UpdateProfileRequest req) {
        return profiles.updateProfile(user.getId(), req);
    }
}
