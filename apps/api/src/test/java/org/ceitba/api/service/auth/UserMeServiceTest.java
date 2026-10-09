package org.ceitba.api.service.auth;

import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.UserFollow;
import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.service.capability.CapabilityService;
import org.ceitba.api.service.news.FollowService;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

// Plain hand-written stubs: no mocking framework needed for four calls.
class UserMeServiceTest {

    private static final Instant NOW = Instant.parse("2026-03-01T12:00:00Z");

    // The staff role is evaluated at the injected clock's time, not the JVM's.
    @Test
    void staffRoleIsEvaluatedAtTheInjectedClock() {
        var staffChecks = new ArrayList<OffsetDateTime>();
        var staff = (CeitbaStaffRepository) Proxy.newProxyInstance(
            CeitbaStaffRepository.class.getClassLoader(), new Class<?>[] {CeitbaStaffRepository.class},
            (proxy, method, args) -> {
                if (!method.getName().equals("isActiveStaff")) throw new UnsupportedOperationException(method.getName());
                staffChecks.add((OffsetDateTime) args[1]);
                return true;
            });
        var memberships = new OrganizationMembershipService(null, null, null, null, null, null) {
            @Override public List<UserOrganization> listForUser(UUID userId) { return List.of(); }
        };
        var follows = new FollowService(null, null, null) {
            @Override public List<UserFollow> listForUser(UUID userId) { return List.of(); }
        };
        var moderators = (CeitbaModeratorRepository) Proxy.newProxyInstance(
            CeitbaModeratorRepository.class.getClassLoader(), new Class<?>[] {CeitbaModeratorRepository.class},
            (proxy, method, args) -> {
                if (!method.getName().equals("isActiveModerator")) throw new UnsupportedOperationException(method.getName());
                return false;
            });
        var capabilities = new CapabilityService(null, null, null, null, null) {
            @Override public Set<String> effective(User user) { return Set.of(); }
        };
        var service = new UserMeService(staff, memberships, follows, moderators, capabilities,
            Clock.fixed(NOW, ZoneOffset.UTC));

        var me = service.describe(new User(UUID.randomUUID(), "a@itba.edu.ar", "A"));

        assertThat(me.role()).isEqualTo("staff");
        assertThat(staffChecks).extracting(OffsetDateTime::toInstant).containsExactly(NOW);
    }
}
