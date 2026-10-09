package org.ceitba.api.service.orgmail;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class OrgAnnouncementListIdTest {

    @Test
    void plainAsciiNameIsKept() {
        assertThat(OrgAnnouncementService.listIdPhrase("SABF", "sabf")).isEqualTo("SABF");
    }

    @Test
    void lineBreaksCannotStartAnotherHeader() {
        String phrase = OrgAnnouncementService.listIdPhrase("Club\r\nBcc: someone@gmail.com", "club");
        assertThat(phrase).doesNotContain("\r").doesNotContain("\n").isEqualTo("Club Bcc: someone@gmail.com");
    }

    @Test
    void nonAsciiNameIsAnEncodedWord() {
        String phrase = OrgAnnouncementService.listIdPhrase("Club de Robótica", "robotica");
        assertThat(phrase).startsWith("=?UTF-8?Q?").matches("[\\x20-\\x7E]+");
    }

    @Test
    void blankNameFallsBackToTheSlug() {
        assertThat(OrgAnnouncementService.listIdPhrase(" <\"> ", "sabf")).isEqualTo("sabf");
        assertThat(OrgAnnouncementService.listIdPhrase(null, "sabf")).isEqualTo("sabf");
    }
}
