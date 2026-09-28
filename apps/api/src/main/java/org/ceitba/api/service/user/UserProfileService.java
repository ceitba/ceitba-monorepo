package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.web.user.dto.MePreferencesResponse;
import org.ceitba.api.web.user.dto.MeProfileResponse;
import org.ceitba.api.web.user.dto.UpdatePreferencesRequest;
import org.ceitba.api.web.user.dto.UpdateProfileRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;

// Self-service profile and preferences behind /v1/me/{profile,preferences}.
//
// PATCH semantics for every field: null = leave alone, "" = clear.
// Invariants kept by updateProfile:
//   * a plan is only ever set together with a career, and must be one of that
//     career's plans (ValidationException otherwise);
//   * changing the career without sending a plan clears the old plan, so the
//     pair can never go stale.
// file_number is not writable here (staff-managed, or filled by the SGA sync).
@Service
public class UserProfileService {

    private final UserRepository userRepository;
    private final CareerRepository careerRepository;
    private final PlanRepository planRepository;

    public UserProfileService(UserRepository userRepository,
                              CareerRepository careerRepository,
                              PlanRepository planRepository) {
        this.userRepository = userRepository;
        this.careerRepository = careerRepository;
        this.planRepository = planRepository;
    }

    @Transactional(readOnly = true)
    public MeProfileResponse getProfile(UUID userId) {
        return toProfile(load(userId));
    }

    @Transactional
    public MeProfileResponse updateProfile(UUID userId, UpdateProfileRequest req) {
        var user = load(userId);

        boolean careerChanged = false;
        if (req.careerId() != null) {
            String id = blankToNull(req.careerId());
            String current = user.getCareer() != null ? user.getCareer().getId() : null;
            if (id == null) {
                user.setCareer(null);
            } else {
                user.setCareer(careerRepository.findById(id)
                    .orElseThrow(() -> new ResourceNotFoundException("Career", id)));
            }
            careerChanged = !Objects.equals(current, id);
        }

        if (req.plan() != null) {
            String planId = blankToNull(req.plan());
            if (planId == null) {
                user.setPlan(null);
            } else {
                var career = user.getCareer();
                if (career == null) {
                    throw new ValidationException("plan", planId, "a plan requires a career");
                }
                boolean belongs = planRepository.findById(planId)
                    .map(p -> p.getCareer().getId().equals(career.getId()))
                    .orElse(false);
                if (!belongs) {
                    throw new ValidationException("plan", planId,
                        "is not a plan of career '%s'".formatted(career.getId()));
                }
                user.setPlan(planId);
            }
        } else if (careerChanged) {
            user.setPlan(null);
        }

        applySocial(req.linkedin(), SocialHandles::linkedin, user::setLinkedin);
        applySocial(req.instagram(), SocialHandles::instagram, user::setInstagram);
        applySocial(req.discord(), SocialHandles::discord, user::setDiscord);

        return toProfile(userRepository.save(user));
    }

    @Transactional(readOnly = true)
    public MePreferencesResponse getPreferences(UUID userId) {
        var user = load(userId);
        return new MePreferencesResponse(user.getTheme(), user.getPreferredLanguage());
    }

    @Transactional
    public MePreferencesResponse updatePreferences(UUID userId, UpdatePreferencesRequest req) {
        var user = load(userId);
        if (req.theme() != null)    user.setTheme(blankToNull(req.theme()));
        if (req.language() != null) user.setPreferredLanguage(blankToNull(req.language()));
        var saved = userRepository.save(user);
        return new MePreferencesResponse(saved.getTheme(), saved.getPreferredLanguage());
    }

    public static MeProfileResponse toProfile(User u) {
        return new MeProfileResponse(
            u.getCareer() != null ? u.getCareer().getId() : null,
            u.getPlan(),
            u.getFileNumber(),
            u.getLinkedin(),
            u.getInstagram(),
            u.getDiscord()
        );
    }

    private User load(UUID userId) {
        return userRepository.findById(userId)
            .orElseThrow(() -> new ResourceNotFoundException("User", userId.toString()));
    }

    private static void applySocial(String raw, Function<String, String> normalize,
                                    Consumer<String> set) {
        if (raw == null) return;
        String v = blankToNull(raw);
        set.accept(v == null ? null : normalize.apply(v));
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }
}
