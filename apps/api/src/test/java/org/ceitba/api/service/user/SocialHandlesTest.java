package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.ValidationException;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SocialHandlesTest {

    @ParameterizedTest
    @CsvSource({
        "jane-doe,jane-doe",
        "@Jane-Doe,jane-doe",
        "linkedin.com/in/jane-doe,jane-doe",
        "https://www.linkedin.com/in/jane-doe/,jane-doe",
        "http://ar.linkedin.com/in/Jane-Doe?trk=abc,jane-doe",
        "HTTPS://LINKEDIN.COM/in/jane-doe/details/experience,jane-doe",
        "josé-pérez,josé-pérez",
        "https://www.linkedin.com/in/jos%C3%A9-p%C3%A9rez,josé-pérez",
        "https://www.linkedin.com/in/Jos%C3%A9-P%C3%A9rez/,josé-pérez",
    })
    void linkedinNormalizes(String in, String out) {
        assertThat(SocialHandles.linkedin(in)).isEqualTo(out);
    }

    @ParameterizedTest
    @ValueSource(strings = {"ab", "https://linkedin.com/company/acme", "https://linkedin.com/", "jane doe",
        "https://notlinkedin.com/in/jane", "jane_doe",
        "https://linkedin.com/in/jane%ZZdoe", "https://linkedin.com/in/jane%20doe", "https://linkedin.com/in/jane+doe"})
    void linkedinRejects(String in) {
        assertThatThrownBy(() -> SocialHandles.linkedin(in)).isInstanceOf(ValidationException.class);
    }

    @ParameterizedTest
    @CsvSource({
        "jane.doe,jane.doe",
        "@Jane_Doe,jane_doe",
        "instagram.com/jane.doe,jane.doe",
        "https://www.instagram.com/jane.doe/?hl=es,jane.doe",
    })
    void instagramNormalizes(String in, String out) {
        assertThat(SocialHandles.instagram(in)).isEqualTo(out);
    }

    @ParameterizedTest
    @ValueSource(strings = {"https://instagram.com/", "jane-doe", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "https://example.com/jane",
        // Non-profile pages: the first segment is not a handle.
        "https://www.instagram.com/p/C0dE123abc/", "https://instagram.com/reel/C0dE123abc",
        "https://instagram.com/reels/C0dE123abc/", "https://instagram.com/stories/jane.doe/123",
        "https://instagram.com/explore/", "https://instagram.com/tv/C0dE123abc",
        "https://instagram.com/accounts/login/", "https://instagram.com/P/abc",
        "https://instagram.com/jane.doe/tagged/"})
    void instagramRejects(String in) {
        assertThatThrownBy(() -> SocialHandles.instagram(in)).isInstanceOf(ValidationException.class);
    }

    @ParameterizedTest
    @CsvSource({
        "jane.doe,jane.doe",
        "@Jane_Doe,jane_doe",
        "Old Name#0420,Old Name#0420",
        "Ñandú Rojo#0001,Ñandú Rojo#0001",
    })
    void discordNormalizes(String in, String out) {
        assertThat(SocialHandles.discord(in)).isEqualTo(out);
    }

    @ParameterizedTest
    @ValueSource(strings = {"j", "jane doe", "jane#12", "a@b#1234", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#1234",
        // Whitespace other than single inner spaces, control and format chars.
        "Old\tName#0420", "Old\nName#0420", "Old\u00A0Name#0420", "Old  Name#0420", "Old \u0000#0420",
        "Old\u200BName#0420", "Name #0420", "Na\u0007me#0420"})
    void discordRejects(String in) {
        assertThatThrownBy(() -> SocialHandles.discord(in)).isInstanceOf(ValidationException.class);
    }
}
