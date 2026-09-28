package org.ceitba.api.service.auth;

import org.ceitba.api.config.ReviewLoginProperties;
import org.ceitba.api.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
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

    @ParameterizedTest
    @EnumSource(BCryptPasswordEncoder.BCryptVersion.class)
    void acceptsEveryStandardBcryptVariant(BCryptPasswordEncoder.BCryptVersion version) {
        String hash = new BCryptPasswordEncoder(version, 4).encode(PASSWORD);
        assertThat(hash).startsWith(version.getVersion() + "$04$").hasSize(60);
        var props = new ReviewLoginProperties(EMAIL, "  " + hash + "\n");
        assertThat(props.status()).isEqualTo(ReviewLoginProperties.Status.ENABLED);

        var real = new ReviewLoginService(props, provisioning);
        when(provisioning.findOrCreate(any(), any(), any(), any()))
            .thenReturn(new User(UUID.randomUUID(), EMAIL, "App Review"));
        assertThat(real.authenticate(EMAIL, PASSWORD)).isNotNull();
        assertThatThrownBy(() -> real.authenticate(EMAIL, "wrong"))
            .isInstanceOf(InvalidCredentialsException.class);
    }

    static List<String> mangledHashes() {
        return List.of(
            "plain-text-password",
            HASH.substring(0, 7) + "%",          // unquoted in .env: compose expanded `$<salt+hash>` to "", plus zsh `%`
            "a2$" + HASH.substring(4),           // mangled prefix
            HASH.substring(7),                   // `$2a$04$` eaten
            HASH + "%",                          // zsh's end-of-line marker pasted along
            HASH + "x",
            HASH.substring(0, 59),               // truncated
            HASH.replace("$04$", "$4$"),         // one-digit cost
            HASH.replace("$04$", "$03$"),        // cost below 04
            HASH.replace("$04$", "$32$"),        // cost above 31
            "$2$" + HASH.substring(4),           // no minor version
            "$2x$" + HASH.substring(4),          // unknown variant
            HASH.substring(0, 30) + "!" + HASH.substring(31)); // char outside bcrypt's base64
    }

    @ParameterizedTest
    @MethodSource("mangledHashes")
    void aMangledHashDisablesReviewLoginInsteadOfFailingStartup(String mangled) {
        var props = new ReviewLoginProperties(EMAIL, mangled);
        assertThat(props.status()).isEqualTo(ReviewLoginProperties.Status.MISCONFIGURED);
        assertThat(props.enabled()).isFalse();

        var enc = new RecordingEncoder();
        var misconfigured = new ReviewLoginService(props, provisioning, enc);
        assertThatThrownBy(() -> misconfigured.authenticate(EMAIL, PASSWORD))
            .isInstanceOf(ReviewLoginDisabledException.class);
        assertThat(enc.checkedAgainst).isEmpty();
        // The production constructor (which reads the cost from the hash) starts too.
        assertThatThrownBy(() -> new ReviewLoginService(props, provisioning).authenticate(EMAIL, PASSWORD))
            .isInstanceOf(ReviewLoginDisabledException.class);
        verifyNoInteractions(provisioning);
    }

    @Test
    void onlyOneOfEmailAndHashIsMisconfigured() {
        assertThat(new ReviewLoginProperties(EMAIL, "").status())
            .isEqualTo(ReviewLoginProperties.Status.MISCONFIGURED);
        assertThat(new ReviewLoginProperties(" ", HASH).status())
            .isEqualTo(ReviewLoginProperties.Status.MISCONFIGURED);
        assertThat(new ReviewLoginProperties(null, null).status())
            .isEqualTo(ReviewLoginProperties.Status.DISABLED);
        assertThat(new ReviewLoginProperties("", "  ").status())
            .isEqualTo(ReviewLoginProperties.Status.DISABLED);
    }

    @Test
    void theMisconfigurationMessageExplainsTheCauseWithoutLeakingTheHash() {
        String msg = ReviewLoginService.misconfiguration(new ReviewLoginProperties(EMAIL, HASH + "%"));
        assertThat(msg)
            .doesNotContain(HASH.substring(7))
            .contains("SINGLE quotes", "61 chars", "%", "docker compose config");
        assertThat(ReviewLoginService.misconfiguration(new ReviewLoginProperties(EMAIL, null)))
            .contains("REVIEW_LOGIN_PASSWORD_HASH is empty");
        assertThat(ReviewLoginService.misconfiguration(new ReviewLoginProperties(null, HASH)))
            .contains("REVIEW_LOGIN_EMAIL is empty")
            .doesNotContain(HASH.substring(7));
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
