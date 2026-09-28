package org.ceitba.api.service.auth;

import org.ceitba.api.config.ReviewLoginProperties;
import org.ceitba.api.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ReviewLoginServiceTest {

    static final String EMAIL = "appreview@example.com";
    static final String PASSWORD = "s3cret-review-pass";
    static final BCryptPasswordEncoder BCRYPT = new BCryptPasswordEncoder(4);
    static final String HASH = BCRYPT.encode(PASSWORD);

    // Records every bcrypt check (the hash it ran against) and delegates.
    static class RecordingEncoder implements PasswordEncoder {
        final List<String> checkedAgainst = new ArrayList<>();
        @Override public String encode(CharSequence raw) { return BCRYPT.encode(raw); }
        @Override public boolean matches(CharSequence raw, String encoded) {
            checkedAgainst.add(encoded);
            return BCRYPT.matches(raw, encoded);
        }
    }

    UserProvisioningService provisioning;
    RecordingEncoder encoder;
    ReviewLoginService service;

    @BeforeEach
    void setUp() {
        provisioning = mock(UserProvisioningService.class);
        encoder = new RecordingEncoder();
        service = new ReviewLoginService(new ReviewLoginProperties(EMAIL, HASH), provisioning, encoder);
    }

    @Test
    void correctCredentialsProvisionTheReviewUser() {
        var user = new User(UUID.randomUUID(), EMAIL, "App Review");
        when(provisioning.findOrCreate(EMAIL, "App Review", null, null)).thenReturn(user);

        assertThat(service.authenticate(" AppReview@Example.com ", PASSWORD)).isSameAs(user);
        assertThat(encoder.checkedAgainst).containsExactly(HASH);
    }

    @Test
    void unknownEmailStillRunsExactlyOneBcryptCheckOfTheSameCost() {
        assertThatThrownBy(() -> service.authenticate("someone@gmail.com", PASSWORD))
            .isInstanceOf(InvalidCredentialsException.class);

        // One check, against the dummy hash (never the real one), same cost.
        assertThat(encoder.checkedAgainst).hasSize(1);
        String dummy = encoder.checkedAgainst.get(0);
        assertThat(dummy).isNotEqualTo(HASH).startsWith("$2a$04$");
        verify(provisioning, never()).findOrCreate(any(), any(), any(), any());
    }

    @Test
    void wrongPasswordRunsOneCheckAgainstTheRealHash() {
        assertThatThrownBy(() -> service.authenticate(EMAIL, "nope"))
            .isInstanceOf(InvalidCredentialsException.class);
        assertThat(encoder.checkedAgainst).containsExactly(HASH);
        verifyNoInteractions(provisioning);
    }

    @Test
    void missingOrOverlongInputStillRunsOneCheck() {
        assertThatThrownBy(() -> service.authenticate(null, null))
            .isInstanceOf(InvalidCredentialsException.class);
        assertThatThrownBy(() -> service.authenticate(EMAIL, null))
            .isInstanceOf(InvalidCredentialsException.class);
        // > 72 bytes: bcrypt would ignore the tail, so it is rejected outright
        // (still after a check), even when it starts with the right password.
        assertThatThrownBy(() -> service.authenticate(EMAIL, PASSWORD + "x".repeat(80)))
            .isInstanceOf(InvalidCredentialsException.class);
        assertThat(encoder.checkedAgainst).hasSize(3);
        verifyNoInteractions(provisioning);
    }

    @Test
    void disabledUnlessBothPropertiesAreSet() {
        for (var props : List.of(new ReviewLoginProperties(null, null),
                                 new ReviewLoginProperties(EMAIL, " "),
                                 new ReviewLoginProperties("", HASH))) {
            var enc = new RecordingEncoder();
            var disabled = new ReviewLoginService(props, provisioning, enc);
            assertThatThrownBy(() -> disabled.authenticate(EMAIL, PASSWORD))
                .isInstanceOf(ReviewLoginDisabledException.class);
            assertThat(enc.checkedAgainst).isEmpty();
        }
        verifyNoInteractions(provisioning);
    }

    @Test
    void aNonBcryptHashFailsStartup() {
        assertThatThrownBy(() -> new ReviewLoginService(
                new ReviewLoginProperties(EMAIL, "plain-text-password"), provisioning))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void productionConstructorUsesTheConfiguredCostForTheDummyHash() {
        var real = new ReviewLoginService(new ReviewLoginProperties(EMAIL, HASH), provisioning);
        assertThatThrownBy(() -> real.authenticate("other@example.com", PASSWORD))
            .isInstanceOf(InvalidCredentialsException.class);
        when(provisioning.findOrCreate(any(), any(), any(), any()))
            .thenReturn(new User(UUID.randomUUID(), EMAIL, "App Review"));
        assertThat(real.authenticate(EMAIL, PASSWORD)).isNotNull();
    }
}
