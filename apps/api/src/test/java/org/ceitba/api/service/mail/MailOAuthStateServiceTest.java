package org.ceitba.api.service.mail;

import org.ceitba.api.config.AuthProperties;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class MailOAuthStateServiceTest {

    private final MutableClock clock = new MutableClock(Instant.parse("2026-10-04T12:00:00Z"));
    private final MailOAuthStateService states = new MailOAuthStateService(auth("dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch"), clock);

    private static AuthProperties auth(String secret) {
        return new AuthProperties(null, null, null, null,
            new AuthProperties.Jwt(secret, 1, null, null, null, null, null), null, null);
    }

    @Test
    void stateBindsTheStaffUserAndExpires() {
        UUID staff = UUID.randomUUID();
        String state = states.issue(staff);
        assertThat(states.verify(state)).contains(staff);
        clock.advance(MailOAuthStateService.TTL.minusSeconds(1));
        assertThat(states.verify(state)).contains(staff);
        clock.advance(Duration.ofSeconds(2));
        assertThat(states.verify(state)).isEmpty();
    }

    @Test
    void forgedTamperedOrForeignStatesAreRejected() {
        UUID staff = UUID.randomUUID();
        String state = states.issue(staff);
        String payload = new String(Base64.getUrlDecoder().decode(state.substring(0, state.indexOf('.'))));
        String forged = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.replace(staff.toString(), UUID.randomUUID().toString()).getBytes())
            + state.substring(state.indexOf('.'));
        assertThat(states.verify(forged)).isEmpty();
        assertThat(states.verify(null)).isEmpty();
        assertThat(states.verify("garbage")).isEmpty();
        assertThat(states.verify("a.b")).isEmpty();
        // Signed with another secret.
        var other = new MailOAuthStateService(auth("b3RoZXItand0LXNlY3JldC1rZXktMzJieXRlcy1sb25n"), clock);
        assertThat(other.verify(state)).isEmpty();
    }
}
