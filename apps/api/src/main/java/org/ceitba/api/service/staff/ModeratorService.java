package org.ceitba.api.service.staff;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.CeitbaModerator;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.auth.ApiKeyCredential;
import org.ceitba.api.web.staff.dto.ModeratorResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

// MODERATOR grants (V19 ceitba_moderators), managed by STAFF under
// /v1/staff/moderators. Active STAFF implies MODERATOR without a row;
// isModerator() is the single place that encodes that rule.
@Service
public class ModeratorService {

    private final CeitbaModeratorRepository moderators;
    private final CeitbaStaffRepository staff;
    private final UserRepository users;
    private final Clock clock;

    public ModeratorService(CeitbaModeratorRepository moderators,
                            CeitbaStaffRepository staff,
                            UserRepository users,
                            Clock clock) {
        this.moderators = moderators;
        this.staff = staff;
        this.users = users;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public boolean isModerator(UUID userId) {
        if (ApiKeyCredential.staffWithheld()) return false;
        return moderators.isActiveModerator(userId)
            || staff.isActiveStaff(userId, OffsetDateTime.now(clock));
    }

    // Explicit grants only; staff-implied moderators are listed by GET /v1/staff.
    @Transactional(readOnly = true)
    public List<ModeratorResponse> listActive() {
        var grants = moderators.findByRevokedAtIsNullOrderByGrantedAtAsc();
        // One batched lookup instead of a findById per grant.
        Map<UUID, User> byId = users.findAllById(grants.stream().map(CeitbaModerator::getUserId).toList())
            .stream()
            .collect(Collectors.toMap(User::getId, Function.identity()));
        return grants.stream()
            .map(m -> toResponse(m, byId.get(m.getUserId())))
            .toList();
    }

    @Transactional
    public ModeratorResponse grant(String email, UUID grantedBy) {
        var user = users.findByEmail(email)
            .orElseThrow(() -> new ResourceNotFoundException("User", email));
        var now = OffsetDateTime.now(clock);
        var existing = moderators.findById(user.getId());
        CeitbaModerator grant;
        if (existing.isPresent()) {
            grant = existing.get();
            if (grant.isActive()) {
                throw new ResourceAlreadyExistsException("Moderator", email);
            }
            grant.regrant(grantedBy, now);
        } else {
            grant = new CeitbaModerator(user.getId(), grantedBy, now);
        }
        return toResponse(moderators.save(grant), user);
    }

    // Revoke keeps the row for audit (revoked_at / revoked_by).
    @Transactional
    public void revoke(UUID userId, UUID revokedBy) {
        var grant = moderators.findById(userId)
            .filter(CeitbaModerator::isActive)
            .orElseThrow(() -> new ResourceNotFoundException("Moderator", userId.toString()));
        grant.revoke(revokedBy, OffsetDateTime.now(clock));
        moderators.save(grant);
    }

    private static ModeratorResponse toResponse(CeitbaModerator m, User u) {
        return new ModeratorResponse(
            m.getUserId(),
            u != null ? u.getEmail() : null,
            u != null ? u.getName() : null,
            m.getGrantedBy(),
            m.getGrantedAt());
    }
}
