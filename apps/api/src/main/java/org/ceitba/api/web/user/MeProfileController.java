package org.ceitba.api.web.user;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.user.dto.MePreferencesResponse;
import org.ceitba.api.web.user.dto.MeProfileResponse;
import org.ceitba.api.web.user.dto.UpdatePreferencesRequest;
import org.ceitba.api.web.user.dto.UpdateProfileRequest;
import org.springframework.transaction.annotation.Transactional;
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
//   /profile      — career + plan. Editable here; file_number is exposed
//                   read-only (assigned by staff via /v1/users/create).
@Tag(name = "Me")
@RestController
@RequestMapping("/v1/me")
public class MeProfileController {

    private final UserRepository userRepository;
    private final CareerRepository careerRepository;

    public MeProfileController(UserRepository userRepository,
                               CareerRepository careerRepository) {
        this.userRepository = userRepository;
        this.careerRepository = careerRepository;
    }

    @GetMapping("/preferences")
    @Operation(summary = "Get current user's theme and language")
    public MePreferencesResponse getPreferences(@CurrentUser User user) {
        return new MePreferencesResponse(user.getTheme(), user.getPreferredLanguage());
    }

    @PatchMapping("/preferences")
    @Transactional
    @Operation(summary = "Update theme and/or language. Null fields are left alone; empty string clears.")
    public MePreferencesResponse patchPreferences(@CurrentUser User user,
                                                   @Valid @RequestBody UpdatePreferencesRequest req) {
        var managed = userRepository.findById(user.getId()).orElseThrow();
        if (req.theme() != null)    managed.setTheme(blankToNull(req.theme()));
        if (req.language() != null) managed.setPreferredLanguage(blankToNull(req.language()));
        var saved = userRepository.save(managed);
        return new MePreferencesResponse(saved.getTheme(), saved.getPreferredLanguage());
    }

    @GetMapping("/profile")
    @Operation(summary = "Get current user's career, plan and file number")
    public MeProfileResponse getProfile(@CurrentUser User user) {
        return new MeProfileResponse(
            user.getCareer() != null ? user.getCareer().getId() : null,
            user.getPlan(),
            user.getFileNumber()
        );
    }

    @PatchMapping("/profile")
    @Transactional
    @Operation(summary = "Update career and/or plan. file_number is staff-managed and not accepted here.")
    public MeProfileResponse patchProfile(@CurrentUser User user,
                                           @Valid @RequestBody UpdateProfileRequest req) {
        var managed = userRepository.findById(user.getId()).orElseThrow();
        if (req.careerId() != null) {
            String id = blankToNull(req.careerId());
            if (id == null) {
                managed.setCareer(null);
            } else {
                var career = careerRepository.findById(id)
                    .orElseThrow(() -> new ResourceNotFoundException("Career", id));
                managed.setCareer(career);
            }
        }
        if (req.plan() != null) managed.setPlan(blankToNull(req.plan()));
        var saved = userRepository.save(managed);
        return new MeProfileResponse(
            saved.getCareer() != null ? saved.getCareer().getId() : null,
            saved.getPlan(),
            saved.getFileNumber()
        );
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }
}
