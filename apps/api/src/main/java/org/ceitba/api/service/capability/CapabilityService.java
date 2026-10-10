package org.ceitba.api.service.capability;

import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.capability.CapabilityOrgGrantRepository;
import org.ceitba.api.repository.capability.CapabilitySettingRepository;
import org.ceitba.api.repository.capability.CapabilityUserGrantRepository;
import org.ceitba.api.service.auth.ApiKeyCredential;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;

// Effective capabilities of a user (docs/CAPABILITIES.md). A user has a
// capability when any holds: active STAFF; enabled_for_all; a grant on their
// email; a grant on an organization they belong to. Unknown keys in the
// tables are ignored.
@Service
public class CapabilityService {

    private final CeitbaStaffRepository staffRepository;
    private final CapabilitySettingRepository settings;
    private final CapabilityUserGrantRepository userGrants;
    private final CapabilityOrgGrantRepository orgGrants;
    private final Clock clock;

    public CapabilityService(CeitbaStaffRepository staffRepository,
                             CapabilitySettingRepository settings,
                             CapabilityUserGrantRepository userGrants,
                             CapabilityOrgGrantRepository orgGrants,
                             Clock clock) {
        this.staffRepository = staffRepository;
        this.settings = settings;
        this.userGrants = userGrants;
        this.orgGrants = orgGrants;
        this.clock = clock;
    }

    // Sorted keys.
    @Transactional(readOnly = true)
    public Set<String> effective(User user) {
        if (user == null) return Set.of();
        Set<String> known = Arrays.stream(Capability.values()).map(Capability::key).collect(Collectors.toSet());
        // Staff hold every capability, unless the caller's API key lacks the staff scope.
        if (!ApiKeyCredential.staffWithheld()
                && staffRepository.isActiveStaff(user.getId(), OffsetDateTime.now(clock))) {
            return new TreeSet<>(known);
        }
        Set<String> granted = new HashSet<>(settings.findEnabledForAll());
        if (user.getEmail() != null) {
            granted.addAll(userGrants.findCapabilitiesByEmail(user.getEmail().toLowerCase(Locale.ROOT)));
        }
        granted.addAll(orgGrants.findCapabilitiesByMember(user.getId()));
        granted.retainAll(known);
        return new TreeSet<>(granted);
    }

    // Of `users`, the ids of those who have `capability`, in at most four
    // queries whatever the number of users (weekly digest batches).
    @Transactional(readOnly = true)
    public Set<UUID> holders(Capability capability, Collection<User> users) {
        if (users.isEmpty()) return Set.of();
        Set<UUID> ids = users.stream().map(User::getId).collect(Collectors.toSet());
        if (settings.findEnabledForAll().contains(capability.key())) return ids;
        Set<UUID> out = new HashSet<>();
        for (var s : staffRepository.findAllActive(OffsetDateTime.now(clock))) {
            if (ids.contains(s.getUserId())) out.add(s.getUserId());
        }
        Set<String> grantedEmails = userGrants.findByCapabilityOrderByEmail(capability.key()).stream()
            .map(g -> g.getEmail().toLowerCase(Locale.ROOT))
            .collect(Collectors.toSet());
        for (var u : users) {
            if (u.getEmail() != null && grantedEmails.contains(u.getEmail().toLowerCase(Locale.ROOT))) out.add(u.getId());
        }
        out.addAll(orgGrants.findMembersWithCapability(capability.key(), ids));
        return out;
    }

    @Transactional(readOnly = true)
    public boolean has(User user, Capability capability) {
        return effective(user).contains(capability.key());
    }

    @Transactional(readOnly = true)
    public void require(User user, Capability capability) {
        if (!has(user, capability)) throw new CapabilityRequiredException(capability);
    }
}
