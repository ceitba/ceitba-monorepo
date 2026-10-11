package org.ceitba.api.service.auth;

import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.UUID;

// The one place services ask whether a user holds staff or moderator powers
// from the database (an active ceitba_staff row, an active moderator grant).
// Both answers are false for a request made with an API key that lacks the
// "staff" scope, whatever its owner holds, so a service can't forget that
// check. ApiKeyFilter applies the same rule to ROLE_STAFF / ROLE_MODERATOR.
//
// Capabilities are not staff powers: staff hold every capability through any
// credential (CapabilityService).
@Component
public class StaffPowers {

    private final CeitbaStaffRepository staff;
    private final CeitbaModeratorRepository moderators;
    private final Clock clock;

    public StaffPowers(CeitbaStaffRepository staff, CeitbaModeratorRepository moderators, Clock clock) {
        this.staff = staff;
        this.moderators = moderators;
        this.clock = clock;
    }

    public boolean isStaff(UUID userId) {
        if (userId == null || ApiKeyCredential.staffWithheld()) return false;
        return staff.isActiveStaff(userId, OffsetDateTime.now(clock));
    }

    // Staff are moderators too.
    public boolean isModerator(UUID userId) {
        if (userId == null || ApiKeyCredential.staffWithheld()) return false;
        return moderators.isActiveModerator(userId) || staff.isActiveStaff(userId, OffsetDateTime.now(clock));
    }
}
