package org.ceitba.api.service.staff;

import org.ceitba.api.domain.CeitbaModerator;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.auth.StaffPowers;
import org.ceitba.api.web.staff.dto.ModeratorResponse;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyIterable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ModeratorServiceTest {

    private final CeitbaModeratorRepository moderators = mock(CeitbaModeratorRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final ModeratorService service = new ModeratorService(moderators,
        new StaffPowers(mock(CeitbaStaffRepository.class), moderators, Clock.systemUTC()), users, Clock.systemUTC());

    @Test
    void listActiveLoadsUsersInOneBatchAndKeepsGrantOrder() {
        var now = OffsetDateTime.now();
        var alice = new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice");
        var bob = new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob");
        var goneId = UUID.randomUUID(); // user row deleted meanwhile
        var grants = List.of(
            new CeitbaModerator(bob.getId(), null, now.minusDays(2)),
            new CeitbaModerator(goneId, null, now.minusDays(1)),
            new CeitbaModerator(alice.getId(), null, now));
        when(moderators.findByRevokedAtIsNullOrderByGrantedAtAsc()).thenReturn(grants);
        when(users.findAllById(anyIterable())).thenReturn(List.of(alice, bob));

        var result = service.listActive();

        assertThat(result).extracting(ModeratorResponse::userId)
            .containsExactly(bob.getId(), goneId, alice.getId());
        assertThat(result).extracting(ModeratorResponse::email)
            .containsExactly("bob@itba.edu.ar", null, "alice@itba.edu.ar");
        verify(users, times(1)).findAllById(anyIterable());
        verify(users, never()).findById(any());
    }
}
