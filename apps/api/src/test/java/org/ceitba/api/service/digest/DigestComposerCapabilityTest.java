package org.ceitba.api.service.digest;

import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.capability.CapabilityOrgGrantRepository;
import org.ceitba.api.repository.capability.CapabilitySettingRepository;
import org.ceitba.api.repository.capability.CapabilityUserGrantRepository;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.service.capability.Capability;
import org.ceitba.api.service.capability.CapabilityService;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

// resumen_semanal gates the recipients (snapshot) and the per-delivery re-check.
class DigestComposerCapabilityTest {

    final UserRepository users = mock(UserRepository.class);
    final UserFollowRepository follows = mock(UserFollowRepository.class);
    final CeitbaStaffRepository staff = mock(CeitbaStaffRepository.class);
    final CapabilitySettingRepository settings = mock(CapabilitySettingRepository.class);
    final CapabilityUserGrantRepository userGrants = mock(CapabilityUserGrantRepository.class);
    final CapabilityOrgGrantRepository orgGrants = mock(CapabilityOrgGrantRepository.class);
    final Clock clock = Clock.fixed(Instant.parse("2026-10-05T15:00:00Z"), ZoneOffset.UTC);
    final User holder = new User(UUID.randomUUID(), "holder@itba.edu.ar", "Holder");
    final User other = new User(UUID.randomUUID(), "other@itba.edu.ar", "Other");

    DigestComposer composer() {
        var caps = new CapabilityService(staff, settings, userGrants, orgGrants, clock);
        var props = new DigestProperties(null, null, null, false, Duration.ofMillis(1), null, false);
        when(users.findDigestAudience("ceitba")).thenReturn(List.of(holder, other));
        when(users.findById(holder.getId())).thenReturn(Optional.of(holder));
        when(users.findById(other.getId())).thenReturn(Optional.of(other));
        when(follows.existsByUserIdAndOrganization(any(), eq("ceitba"))).thenReturn(true);
        when(userGrants.findByCapabilityOrderByEmail(Capability.RESUMEN_SEMANAL.key())).thenReturn(List.of());
        return new DigestComposer(mock(ArticleRepository.class), mock(NewsEventRepository.class), follows, users,
            null, (r, i) -> java.util.Map.of(), props, caps, clock);
    }

    @Test
    void nonHoldersAreExcludedAndEnabledForAllIncludesEveryone() {
        var c = composer();
        // Nobody holds the capability yet.
        when(settings.findEnabledForAll()).thenReturn(List.of());
        assertThat(c.recipients()).isEmpty();
        assertThat(c.stillEligible(holder.getId(), holder.getEmail())).isFalse();

        // Enabled for everyone: both are recipients and stay eligible.
        when(settings.findEnabledForAll()).thenReturn(List.of(Capability.RESUMEN_SEMANAL.key()));
        assertThat(c.recipients()).extracting(DigestComposer.Recipient::userId)
            .containsExactlyInAnyOrder(holder.getId(), other.getId());
        assertThat(c.stillEligible(other.getId(), other.getEmail())).isTrue();
    }
}
