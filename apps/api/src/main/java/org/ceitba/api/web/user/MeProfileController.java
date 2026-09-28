package org.ceitba.api.web.user;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.user.AcademicProfileSyncService;
import org.ceitba.api.service.user.UserProfileService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.user.dto.MePreferencesResponse;
import org.ceitba.api.web.user.dto.MeProfileResponse;
import org.ceitba.api.web.user.dto.UpdatePreferencesRequest;
import org.ceitba.api.web.user.dto.UpdateProfileRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
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
//   /profile      — career + plan + social handles. Editable here;
//                   file_number is exposed read-only (assigned by staff via
//                   /v1/users/create or filled from SGA).
@Tag(name = "Me")
@RestController
@RequestMapping("/v1/me")
public class MeProfileController {

    private final UserProfileService profiles;
    private final AcademicProfileSyncService academicSync;

    public MeProfileController(UserProfileService profiles, AcademicProfileSyncService academicSync) {
        this.profiles = profiles;
        this.academicSync = academicSync;
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
    @Operation(summary = "Update career, plan and/or social handles",
        description = "Null fields are left alone; empty string clears. `plan` must be a plan id of the "
            + "resulting career (400 otherwise); changing `careerId` without `plan` clears the plan. "
            + "Social fields accept a handle, @handle or profile URL and are stored as the bare handle. "
            + "file_number is staff-managed and not accepted here.")
    public MeProfileResponse patchProfile(@CurrentUser User user,
                                           @Valid @RequestBody UpdateProfileRequest req) {
        return profiles.updateProfile(user.getId(), req);
    }

    @PostMapping("/profile/sync-from-sga")
    @Operation(summary = "Prefill file number, career and plan from the ITBA SGA",
        description = "Looks the user up in SGA by their institutional email and fills only the fields "
            + "that are still empty; values already set are never overwritten. Returns the resulting "
            + "profile (unchanged when SGA does not know the user). 502 when the SGA gateway fails.")
    public MeProfileResponse syncFromSga(@CurrentUser User user) {
        academicSync.syncNow(user.getId());
        return profiles.getProfile(user.getId());
    }
}
